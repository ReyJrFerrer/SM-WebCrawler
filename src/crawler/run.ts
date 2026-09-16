import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config";
import { fetchAllProducts, type FetchAllProductsResult } from "../graphql/client";
import { diffSnapshots, filterSnapshotContext, isSnapshotPlausible, toHistoryEvents } from "../products/diff";
import { normalizeProducts } from "../products/normalize";
import type { CrawlLogRow, CrawlStatus, HistoryEvent, NormalizedProduct } from "../products/types";
import { createSheetsApi } from "../sheets/client";
import { readCurrentProducts } from "../sheets/read-current";
import { appendCrawlLog, appendHistory, ensureTabHeaders, replaceCurrentSnapshot } from "../sheets/write";
import { errorCodeOf, errorMessageOf } from "../utils/errors";
import { nowIso } from "../utils/time";
import { buildCrawlLogRow, emitLog } from "./logging";

export type CrawlSummary = {
  ok: boolean;
  runId: string;
  status: CrawlStatus;
  categoryId: string;
  pagesFetched: number;
  productsFetched: number;
  productsWritten: number;
  newCount: number;
  changedCount: number;
  removedCount: number;
  finishedAt: string;
  error?: { code: string; message: string };
};

export type CrawlerDependencies = {
  fetchAllProducts: (config: AppConfig) => Promise<FetchAllProductsResult>;
  ensureHeaders: (config: AppConfig) => Promise<void>;
  readCurrentProducts: (config: AppConfig) => Promise<NormalizedProduct[]>;
  replaceCurrentSnapshot: (
    config: AppConfig,
    existing: NormalizedProduct[],
    snapshot: NormalizedProduct[],
  ) => Promise<void>;
  appendHistory: (config: AppConfig, events: HistoryEvent[]) => Promise<void>;
  appendLog: (config: AppConfig, row: CrawlLogRow) => Promise<void>;
  uuid: () => string;
  now: () => string;
};

export function createDefaultDependencies(config: AppConfig): CrawlerDependencies {
  const sheets = createSheetsApi(config.googleServiceAccountJson);
  return {
    fetchAllProducts: (cfg) => fetchAllProducts({ config: cfg }),
    ensureHeaders: (cfg) => ensureTabHeaders({ config: cfg, sheets }),
    readCurrentProducts: async (cfg) => {
      const result = await readCurrentProducts({ config: cfg, sheets });
      return result.products;
    },
    replaceCurrentSnapshot: (cfg, existing, snapshot) =>
      replaceCurrentSnapshot({ config: cfg, sheets, existing, snapshot }),
    appendHistory: (cfg, events) => appendHistory({ config: cfg, sheets, events }),
    appendLog: (cfg, row) => appendCrawlLog({ config: cfg, sheets, row }),
    uuid: () => randomUUID(),
    now: () => nowIso(),
  };
}

function summaryFromLog(config: AppConfig, row: CrawlLogRow, error?: { code: string; message: string }): CrawlSummary {
  return {
    ok: row.status === "success",
    runId: row.run_id,
    status: row.status,
    categoryId: config.categoryId,
    pagesFetched: row.pages_fetched,
    productsFetched: row.products_fetched,
    productsWritten: row.products_written,
    newCount: row.new_count,
    changedCount: row.changed_count,
    removedCount: row.removed_count,
    finishedAt: row.finished_at,
    error,
  };
}

async function safeAppendLog(
  deps: CrawlerDependencies,
  config: AppConfig,
  row: CrawlLogRow,
): Promise<void> {
  try {
    await deps.appendLog(config, row);
  } catch (error) {
    emitLog({
      event: "crawl_log_write_failed",
      runId: row.run_id,
      status: row.status,
      errorCode: errorCodeOf(error),
      errorMessage: errorMessageOf(error),
    });
  }
}

export async function runCrawl(options: {
  config: AppConfig;
  runId: string;
  startedAt: string;
  deps?: CrawlerDependencies;
}): Promise<CrawlSummary> {
  const config = options.config;
  const started = Date.now();
  let deps: CrawlerDependencies | undefined = options.deps;

  const logBase = {
    config,
    runId: options.runId,
    startedAt: options.startedAt,
  };
  let pagesFetched = 0;
  let productsFetched = 0;
  let httpStatusSummary = "";

  try {
    if (!deps) {
      deps = createDefaultDependencies(config);
    }
    const runtime = deps;
    await runtime.ensureHeaders(config);

    const fetched = await runtime.fetchAllProducts(config);
    pagesFetched = fetched.pagesFetched;
    productsFetched = fetched.productsFetched;
    httpStatusSummary = fetched.httpStatusSummary;
    const { products, skipped } = normalizeProducts(fetched.items, config, options.startedAt);
    const existing = await runtime.readCurrentProducts(config);
    const previous = filterSnapshotContext(existing, {
      source: config.sourceName,
      store_context: config.storeContext,
      category_id: config.categoryId,
    });

    if (!fetched.complete) {
      const finishedAt = runtime.now();
      const row = buildCrawlLogRow({
        ...logBase,
        finishedAt,
        status: "partial",
        pagesFetched: fetched.pagesFetched,
        productsFetched: fetched.productsFetched,
        productsWritten: 0,
        newCount: 0,
        changedCount: 0,
        removedCount: 0,
        httpStatusSummary: fetched.httpStatusSummary,
        errorCode: fetched.errorCode ?? "PARTIAL_FETCH",
        errorMessage: fetched.errorMessage ?? "Source pagination did not complete",
      });
      await safeAppendLog(runtime, config, row);
      emitLog({
        event: "crawl_completed",
        runId: options.runId,
        categoryId: config.categoryId,
        pagesFetched: fetched.pagesFetched,
        productsFetched: fetched.productsFetched,
        skipped,
        durationMs: Date.now() - started,
        status: "partial",
      });
      return summaryFromLog(config, row, {
        code: row.error_code,
        message: row.error_message,
      });
    }

    if (!isSnapshotPlausible(previous.length, products.length, config.minSnapshotRatio)) {
      const finishedAt = runtime.now();
      const message = `Snapshot count ${products.length} is below ${config.minSnapshotRatio} of previous ${previous.length}`;
      const row = buildCrawlLogRow({
        ...logBase,
        finishedAt,
        status: "partial",
        pagesFetched: fetched.pagesFetched,
        productsFetched: fetched.productsFetched,
        productsWritten: 0,
        newCount: 0,
        changedCount: 0,
        removedCount: 0,
        httpStatusSummary: fetched.httpStatusSummary,
        errorCode: "SNAPSHOT_IMPLAUSIBLE",
        errorMessage: message,
      });
      await safeAppendLog(runtime, config, row);
      emitLog({
        event: "crawl_completed",
        runId: options.runId,
        categoryId: config.categoryId,
        pagesFetched: fetched.pagesFetched,
        productsFetched: fetched.productsFetched,
        durationMs: Date.now() - started,
        status: "partial",
        errorCode: "SNAPSHOT_IMPLAUSIBLE",
      });
      return summaryFromLog(config, row, { code: "SNAPSHOT_IMPLAUSIBLE", message });
    }

    const diff = diffSnapshots(previous, products);
    const finishedAt = runtime.now();
    const events = toHistoryEvents({
      diff,
      runId: options.runId,
      capturedAt: finishedAt,
      includeRemoved: true,
      uuid: runtime.uuid,
    });

    await runtime.replaceCurrentSnapshot(config, existing, products);
    await runtime.appendHistory(config, events);

    const row = buildCrawlLogRow({
      ...logBase,
      finishedAt,
      status: "success",
      pagesFetched: fetched.pagesFetched,
      productsFetched: fetched.productsFetched,
      productsWritten: products.length,
      newCount: diff.newProducts.length,
      changedCount: diff.changed.length,
      removedCount: diff.removed.length,
      httpStatusSummary: fetched.httpStatusSummary,
      errorCode: skipped > 0 ? "ITEMS_SKIPPED" : "",
      errorMessage: skipped > 0 ? `Skipped ${skipped} item(s) without a stable product key` : "",
    });
    await safeAppendLog(runtime, config, row);
    emitLog({
      event: "crawl_completed",
      runId: options.runId,
      categoryId: config.categoryId,
      pagesFetched: fetched.pagesFetched,
      productsFetched: fetched.productsFetched,
      newCount: diff.newProducts.length,
      changedCount: diff.changed.length,
      removedCount: diff.removed.length,
      durationMs: Date.now() - started,
      status: "success",
    });
    return summaryFromLog(config, row);
  } catch (error) {
    const finishedAt = deps?.now() ?? nowIso();
    const code = errorCodeOf(error);
    const message = errorMessageOf(error);
    const row = buildCrawlLogRow({
      ...logBase,
      finishedAt,
      status: "failed",
      pagesFetched,
      productsFetched,
      productsWritten: 0,
      newCount: 0,
      changedCount: 0,
      removedCount: 0,
      httpStatusSummary,
      errorCode: code,
      errorMessage: message,
    });
    if (deps) {
      await safeAppendLog(deps, config, row);
    }
    emitLog({
      event: "crawl_completed",
      runId: options.runId,
      categoryId: config.categoryId,
      durationMs: Date.now() - started,
      status: "failed",
      errorCode: code,
    });
    return summaryFromLog(config, row, { code, message });
  }
}
