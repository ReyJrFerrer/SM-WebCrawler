import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadConfig } from "../src/config";
import { buildCrawlLogRow, emitLog } from "../src/crawler/logging";
import { createDefaultDependencies } from "../src/crawler/run";
import { fetchProductPage } from "../src/graphql/client";
import { diffSnapshots, filterSnapshotContext, toHistoryEvents } from "../src/products/diff";
import { normalizeProducts } from "../src/products/normalize";
import type { NormalizedProduct } from "../src/products/types";
import { errorCodeOf, errorMessageOf } from "../src/utils/errors";
import { nowIso } from "../src/utils/time";

const SMOKE_PAGE_SIZE = 10;

function parseArgs(argv: string[]): { fromFile?: string } {
  const index = argv.indexOf("--from-file");
  if (index === -1) {
    return {};
  }
  const fromFile = argv[index + 1];
  if (!fromFile || fromFile.startsWith("-")) {
    throw new Error("Usage: bun run scripts/run-crawl.ts [--from-file tmp/first-products.json]");
  }
  return { fromFile };
}

function loadProductsFromFile(path: string, lastSeenAt: string): NormalizedProduct[] {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  const products = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && "products" in parsed
      ? (parsed as { products: unknown }).products
      : null;
  if (!Array.isArray(products)) {
    throw new Error("File must contain a products array");
  }
  return products.filter((item): item is NormalizedProduct => {
    return Boolean(item && typeof item === "object" && "product_id" in item && String((item as NormalizedProduct).product_id));
  }).map((product) => ({ ...product, last_seen_at: lastSeenAt }));
}

const args = parseArgs(process.argv.slice(2));
const config = loadConfig();
const runId = randomUUID();
const startedAt = nowIso();
const deps = createDefaultDependencies(config);

let pagesFetched = 0;
let productsFetched = 0;
let httpStatusSummary = "";

try {
  await deps.ensureHeaders(config);

  let products: NormalizedProduct[];
  if (args.fromFile) {
    products = loadProductsFromFile(args.fromFile, startedAt);
    productsFetched = products.length;
    httpStatusSummary = "from-file";
  } else {
    const smokeConfig = { ...config, pageSize: SMOKE_PAGE_SIZE };
    const page = await fetchProductPage({ config: smokeConfig, page: 1 });
    pagesFetched = 1;
    productsFetched = page.items.length;
    httpStatusSummary = String(page.httpStatus);
    products = normalizeProducts(page.items, smokeConfig, startedAt).products;
  }

  const existing = await deps.readCurrentProducts(config);
  const previous = filterSnapshotContext(existing, {
    source: config.sourceName,
    store_context: config.storeContext,
    category_id: config.categoryId,
  });
  const diff = diffSnapshots(previous, products);
  const finishedAt = deps.now();
  const events = toHistoryEvents({
    diff,
    runId,
    capturedAt: finishedAt,
    includeRemoved: false,
    uuid: deps.uuid,
  });

  await deps.replaceCurrentSnapshot(config, existing, products);
  await deps.appendHistory(config, events);

  const row = buildCrawlLogRow({
    config,
    runId,
    startedAt,
    finishedAt,
    status: "success",
    pagesFetched,
    productsFetched,
    productsWritten: products.length,
    newCount: diff.newProducts.length,
    changedCount: diff.changed.length,
    removedCount: 0,
    httpStatusSummary,
    errorCode: "",
    errorMessage: "local first-page smoke run",
  });
  try {
    await deps.appendLog(config, row);
  } catch (error) {
    emitLog({
      event: "crawl_log_write_failed",
      runId,
      errorCode: errorCodeOf(error),
      errorMessage: errorMessageOf(error),
    });
  }

  const summary = {
    ok: true,
    runId,
    status: "success",
    categoryId: config.categoryId,
    pagesFetched,
    productsFetched,
    productsWritten: products.length,
    newCount: diff.newProducts.length,
    changedCount: diff.changed.length,
    removedCount: 0,
    finishedAt,
  };
  emitLog({ event: "crawl_completed", ...summary });
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  const finishedAt = nowIso();
  const code = errorCodeOf(error);
  const message = errorMessageOf(error);
  const row = buildCrawlLogRow({
    config,
    runId,
    startedAt,
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
  try {
    await deps.appendLog(config, row);
  } catch {
    emitLog({
      event: "crawl_log_write_failed",
      runId,
      errorCode: code,
      errorMessage: message,
    });
  }
  const summary = {
    ok: false,
    runId,
    status: "failed",
    error: { code, message },
    finishedAt,
  };
  emitLog({ event: "crawl_completed", ...summary });
  console.error(JSON.stringify(summary, null, 2));
  process.exitCode = 1;
}
