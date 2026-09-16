import { mkdirSync, writeFileSync } from "node:fs";
import { fetchProductPage } from "../src/graphql/client";
import { normalizeProducts } from "../src/products/normalize";
import type { AppConfig } from "../src/config";

const config: AppConfig = {
  graphqlUrl: "https://smmarkets.ph/graphql",
  categoryId: "2398",
  pageSize: 10,
  maxPagesPerRun: 1,
  storeContext: "SM_MARKETS_ONLINE",
  sourceName: "smmarkets-graphql",
  spreadsheetId: "unused",
  googleServiceAccountJson: "{}",
  cronSecret: undefined,
  allowLocalCron: true,
  fetchTimeoutMs: 20_000,
  maxFetchRetries: 2,
  crawlerVersion: "dev",
  minSnapshotRatio: 0.5,
  deploymentEnvironment: "development",
  isProduction: false,
};

const fetchedAt = new Date().toISOString();
const page = await fetchProductPage({ config, page: 1 });
const { products, skipped } = normalizeProducts(page.items, config, fetchedAt);

const output = {
  fetchedAt,
  graphqlUrl: config.graphqlUrl,
  categoryId: config.categoryId,
  httpStatus: page.httpStatus,
  totalCount: page.totalCount,
  pageInfo: page.pageInfo,
  rawCount: page.items.length,
  skipped,
  products,
};

mkdirSync("tmp", { recursive: true });
writeFileSync("tmp/first-products.json", JSON.stringify(output, null, 2));
console.log(JSON.stringify({ saved: "tmp/first-products.json", count: products.length, totalCount: page.totalCount, pageInfo: page.pageInfo }, null, 2));
