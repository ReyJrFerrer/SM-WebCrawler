import { describe, expect, it, vi } from "vitest";
import { graphqlResponseSchema, sourceProductSchema } from "../src/graphql/schemas";
import { fetchAllProducts, fetchProductPage, type FetchLike } from "../src/graphql/client";
import { CrawlerError } from "../src/utils/errors";
import { makeConfig, makeSourceProduct } from "./helpers";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function pageBody(items: unknown[], page: number, totalPages: number) {
  return {
    data: {
      unbxdProducts: {
        items,
        total_count: items.length,
        page_info: { current_page: page, page_size: 100, total_pages: totalPages },
      },
    },
  };
}

describe("GraphQL Zod validation", () => {
  it("accepts a valid product item", () => {
    expect(sourceProductSchema.parse(makeSourceProduct()).id).toBe("101");
  });

  it("accepts a valid envelope", () => {
    const parsed = graphqlResponseSchema.parse(pageBody([makeSourceProduct()], 1, 1));
    expect(parsed.data?.unbxdProducts?.page_info?.total_pages).toBe(1);
  });
});

describe("fetchProductPage", () => {
  it("returns a one-page payload", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(pageBody([makeSourceProduct()], 1, 1)));
    const result = await fetchProductPage({ config: makeConfig(), page: 1, fetchImpl });
    expect(result.items).toHaveLength(1);
    expect(result.httpStatus).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://smmarkets.ph/graphql",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"currentPage":1'),
      }),
    );
  });

  it("treats GraphQL errors as a failed request", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: null, errors: [{ message: "No such field" }] }),
    );
    await expect(fetchProductPage({ config: makeConfig(), page: 1, fetchImpl })).rejects.toMatchObject({
      code: "SOURCE_GRAPHQL_ERROR",
    });
  });

  it("fails on non-200 responses without retrying 403", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "nope" }, 403));
    await expect(
      fetchProductPage({ config: makeConfig({ maxFetchRetries: 2 }), page: 1, fetchImpl }),
    ).rejects.toMatchObject({ code: "SOURCE_BLOCKED" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries HTTP 429 then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("slow", { status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(jsonResponse(pageBody([makeSourceProduct()], 1, 1)));
    const sleepFn = vi.fn(async () => undefined);
    const result = await fetchProductPage({
      config: makeConfig({ maxFetchRetries: 2 }),
      page: 1,
      fetchImpl,
      sleepFn,
    });
    expect(result.items).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("times out when the abort signal fires", async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("Aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    });
    await expect(
      fetchProductPage({
        config: makeConfig({ fetchTimeoutMs: 20, maxFetchRetries: 0 }),
        page: 1,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(CrawlerError);
  });
});

describe("fetchAllProducts", () => {
  it("paginates until total_pages is reached", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const page = body.variables.currentPage as number;
      return jsonResponse(pageBody([makeSourceProduct({ id: String(page) })], page, 3));
    });
    const result = await fetchAllProducts({
      config: makeConfig({ pageSize: 1, maxPagesPerRun: 10 }),
      fetchImpl: fetchImpl as FetchLike,
    });
    expect(result.complete).toBe(true);
    expect(result.pagesFetched).toBe(3);
    expect(result.productsFetched).toBe(3);
    expect(result.httpStatusSummary).toBe("200,200,200");
  });

  it("stops when page_info is absent and the page is short", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: {
          unbxdProducts: {
            items: [makeSourceProduct()],
            total_count: 1,
          },
        },
      }),
    );
    const result = await fetchAllProducts({
      config: makeConfig({ pageSize: 100 }),
      fetchImpl,
    });
    expect(result.complete).toBe(true);
    expect(result.pagesFetched).toBe(1);
  });

  it("keeps duplicate source IDs until normalization", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        pageBody([makeSourceProduct({ id: "1" }), makeSourceProduct({ id: "1", name: "Dup" })], 1, 1),
      ),
    );
    const result = await fetchAllProducts({ config: makeConfig(), fetchImpl });
    expect(result.productsFetched).toBe(2);
    expect(result.items.map((item) => item.id)).toEqual(["1", "1"]);
  });

  it("returns an empty complete result", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: { unbxdProducts: { items: [], total_count: 0 } },
      }),
    );
    const result = await fetchAllProducts({ config: makeConfig(), fetchImpl });
    expect(result.complete).toBe(true);
    expect(result.productsFetched).toBe(0);
  });

  it("marks the run partial when pagination metadata is inconsistent", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(pageBody([makeSourceProduct()], 9, 3)));
    const result = await fetchAllProducts({ config: makeConfig(), fetchImpl });
    expect(result.complete).toBe(false);
    expect(result.errorCode).toBe("PAGINATION_INCONSISTENT");
  });

  it("enforces MAX_PAGES_PER_RUN", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const page = body.variables.currentPage as number;
      return jsonResponse(pageBody([makeSourceProduct({ id: String(page) })], page, 50));
    });
    const result = await fetchAllProducts({
      config: makeConfig({ maxPagesPerRun: 2, pageSize: 1 }),
      fetchImpl: fetchImpl as FetchLike,
    });
    expect(result.complete).toBe(false);
    expect(result.errorCode).toBe("MAX_PAGES_EXCEEDED");
    expect(result.pagesFetched).toBe(2);
  });
});
