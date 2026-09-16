import type { AppConfig } from "../config";
import { CrawlerError, sanitizeErrorMessage } from "../utils/errors";
import { parseRetryAfter } from "../utils/time";
import { withRetry } from "../utils/retry";
import { GET_CATEGORY_PRODUCTS_OPERATION, GET_CATEGORY_PRODUCTS_QUERY } from "./queries";
import {
  graphqlResponseSchema,
  sourceProductSchema,
  type SourceProduct,
} from "./schemas";

export type FetchLike = typeof fetch;

export type ProductPage = {
  items: SourceProduct[];
  totalCount: number | null;
  pageInfo: {
    currentPage: number | null;
    pageSize: number | null;
    totalPages: number | null;
  };
  httpStatus: number;
};

export type FetchAllProductsResult = {
  items: SourceProduct[];
  pagesFetched: number;
  productsFetched: number;
  httpStatusSummary: string;
  complete: boolean;
  errorCode?: string;
  errorMessage?: string;
};

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const name = "name" in error ? String(error.name) : "";
  return name === "AbortError" || name === "TimeoutError" || name === "DOMException";
}

function isRetryableSourceError(error: unknown): boolean {
  if (error instanceof CrawlerError) {
    return error.retryable;
  }
  return isTimeoutError(error);
}

function retryAfterFromError(error: unknown): number | undefined {
  if (error instanceof CrawlerError) {
    return error.retryAfterMs;
  }
  return undefined;
}

function looksLikeHtml(contentType: string, body: string): boolean {
  if (contentType.includes("text/html")) {
    return true;
  }
  const prefix = body.trim().slice(0, 200).toLowerCase();
  return prefix.startsWith("<!doctype") || prefix.startsWith("<html") || prefix.includes("captcha");
}

export async function fetchProductPage(options: {
  config: AppConfig;
  page: number;
  fetchImpl?: FetchLike;
  sleepFn?: (ms: number) => Promise<void>;
}): Promise<ProductPage> {
  const { config, page } = options;
  const fetchImpl = options.fetchImpl ?? fetch;

  return withRetry(
    async () => {
      let response: Response;
      try {
        response = await fetchImpl(config.graphqlUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            operationName: GET_CATEGORY_PRODUCTS_OPERATION,
            variables: {
              categoryId: config.categoryId,
              pageSize: config.pageSize,
              currentPage: page,
            },
            query: GET_CATEGORY_PRODUCTS_QUERY,
          }),
          signal: AbortSignal.timeout(config.fetchTimeoutMs),
        });
      } catch (error) {
        if (isTimeoutError(error)) {
          throw new CrawlerError("SOURCE_TIMEOUT", `Request timed out after ${config.fetchTimeoutMs}ms`, {
            retryable: true,
            cause: error,
          });
        }
        throw new CrawlerError("SOURCE_HTTP_ERROR", sanitizeErrorMessage((error as Error).message), {
          retryable: true,
          cause: error,
        });
      }

      const contentType = response.headers.get("content-type") ?? "";
      const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
      const bodyText = await response.text();

      if (response.status === 401 || response.status === 403) {
        throw new CrawlerError("SOURCE_BLOCKED", `Source returned HTTP ${response.status}`, {
          httpStatus: response.status,
        });
      }

      if (response.status === 429) {
        throw new CrawlerError("SOURCE_HTTP_ERROR", "Source returned HTTP 429", {
          httpStatus: 429,
          retryable: true,
          retryAfterMs,
        });
      }

      if (response.status >= 500) {
        throw new CrawlerError("SOURCE_HTTP_ERROR", `Source returned HTTP ${response.status}`, {
          httpStatus: response.status,
          retryable: true,
          retryAfterMs,
        });
      }

      if (!response.ok) {
        throw new CrawlerError("SOURCE_HTTP_ERROR", `Source returned HTTP ${response.status}`, {
          httpStatus: response.status,
        });
      }

      if (looksLikeHtml(contentType, bodyText)) {
        throw new CrawlerError("SOURCE_BLOCKED", "Received HTML instead of GraphQL JSON", {
          httpStatus: response.status,
        });
      }

      let json: unknown;
      try {
        json = JSON.parse(bodyText);
      } catch {
        throw new CrawlerError("SOURCE_VALIDATION_ERROR", "Source response was not valid JSON", {
          httpStatus: response.status,
        });
      }

      const parsed = graphqlResponseSchema.safeParse(json);
      if (!parsed.success) {
        throw new CrawlerError("SOURCE_VALIDATION_ERROR", "Source GraphQL response failed validation", {
          httpStatus: response.status,
        });
      }

      if (parsed.data.errors && parsed.data.errors.length > 0) {
        const first = parsed.data.errors[0]?.message || "GraphQL returned an error response.";
        throw new CrawlerError("SOURCE_GRAPHQL_ERROR", sanitizeErrorMessage(first), {
          httpStatus: response.status,
        });
      }

      const payload = parsed.data.data?.unbxdProducts;
      if (!payload) {
        throw new CrawlerError("SOURCE_VALIDATION_ERROR", "GraphQL response missing unbxdProducts", {
          httpStatus: response.status,
        });
      }

      const items: SourceProduct[] = [];
      for (const item of payload.items ?? []) {
        const product = sourceProductSchema.safeParse(item);
        if (product.success) {
          items.push(product.data);
        }
      }

      return {
        items,
        totalCount: payload.total_count ?? null,
        pageInfo: {
          currentPage: payload.page_info?.current_page ?? null,
          pageSize: payload.page_info?.page_size ?? null,
          totalPages: payload.page_info?.total_pages ?? null,
        },
        httpStatus: response.status,
      };
    },
    {
      maxRetries: config.maxFetchRetries,
      isRetryable: isRetryableSourceError,
      getRetryAfterMs: retryAfterFromError,
      sleepFn: options.sleepFn,
    },
  );
}

export async function fetchAllProducts(options: {
  config: AppConfig;
  fetchImpl?: FetchLike;
  sleepFn?: (ms: number) => Promise<void>;
}): Promise<FetchAllProductsResult> {
  const { config } = options;
  const collected: SourceProduct[] = [];
  const statuses: number[] = [];
  let page = 1;
  let complete = true;
  let errorCode: string | undefined;
  let errorMessage: string | undefined;

  while (true) {
    if (page > config.maxPagesPerRun) {
      complete = false;
      errorCode = "MAX_PAGES_EXCEEDED";
      errorMessage = `Reached MAX_PAGES_PER_RUN (${config.maxPagesPerRun}) before completing pagination`;
      break;
    }

    const result = await fetchProductPage({
      config,
      page,
      fetchImpl: options.fetchImpl,
      sleepFn: options.sleepFn,
    });
    statuses.push(result.httpStatus);
    collected.push(...result.items);

    const totalPages = result.pageInfo.totalPages;
    if (totalPages != null) {
      if (result.pageInfo.currentPage != null && result.pageInfo.currentPage !== page) {
        complete = false;
        errorCode = "PAGINATION_INCONSISTENT";
        errorMessage = `Expected page ${page} but source returned current_page ${result.pageInfo.currentPage}`;
        break;
      }
      if (page >= totalPages) {
        break;
      }
      if (result.items.length === 0) {
        complete = false;
        errorCode = "PAGINATION_INCONSISTENT";
        errorMessage = `Empty page ${page} before total_pages ${totalPages}`;
        break;
      }
      page += 1;
      continue;
    }

    if (result.items.length < config.pageSize) {
      break;
    }
    page += 1;
  }

  return {
    items: collected,
    pagesFetched: statuses.length,
    productsFetched: collected.length,
    httpStatusSummary: statuses.join(","),
    complete,
    errorCode,
    errorMessage,
  };
}
