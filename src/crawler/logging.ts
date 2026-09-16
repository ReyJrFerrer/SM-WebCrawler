import type { AppConfig } from "../config";
import type { CrawlLogRow, CrawlStatus } from "../products/types";

export function emitLog(fields: Record<string, unknown>): void {
  console.log(JSON.stringify(fields));
}

export function buildCrawlLogRow(input: {
  config: AppConfig;
  runId: string;
  startedAt: string;
  finishedAt: string;
  status: CrawlStatus;
  pagesFetched: number;
  productsFetched: number;
  productsWritten: number;
  newCount: number;
  changedCount: number;
  removedCount: number;
  httpStatusSummary: string;
  errorCode: string;
  errorMessage: string;
}): CrawlLogRow {
  return {
    run_id: input.runId,
    started_at: input.startedAt,
    finished_at: input.finishedAt,
    status: input.status,
    source: input.config.sourceName,
    category_id: input.config.categoryId,
    store_context: input.config.storeContext,
    pages_fetched: input.pagesFetched,
    products_fetched: input.productsFetched,
    products_written: input.productsWritten,
    new_count: input.newCount,
    changed_count: input.changedCount,
    removed_count: input.removedCount,
    http_status_summary: input.httpStatusSummary,
    error_code: input.errorCode,
    error_message: input.errorMessage,
    deployment_environment: input.config.deploymentEnvironment,
    crawler_version: input.config.crawlerVersion,
  };
}
