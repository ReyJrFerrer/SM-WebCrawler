import type { AppConfig } from "../src/config";
import type { SourceProduct } from "../src/graphql/schemas";
import { contentHash } from "../src/products/hash";
import type { NormalizedProduct } from "../src/products/types";

export function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    graphqlUrl: "https://smmarkets.ph/graphql",
    categoryId: "2398",
    pageSize: 100,
    maxPagesPerRun: 100,
    storeContext: "SM_MARKETS_ONLINE",
    sourceName: "smmarkets-graphql",
    spreadsheetId: "sheet-id",
    googleServiceAccountJson: JSON.stringify({
      client_email: "sa@example.com",
      private_key: "-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----\n",
    }),
    cronSecret: "test-secret",
    allowLocalCron: false,
    fetchTimeoutMs: 20_000,
    maxFetchRetries: 2,
    crawlerVersion: "test",
    minSnapshotRatio: 0.5,
    deploymentEnvironment: "test",
    isProduction: true,
    ...overrides,
  };
}

export function makeSourceProduct(overrides: Partial<SourceProduct> = {}): SourceProduct {
  return {
    id: "101",
    uid: "uid-101",
    sku: "SKU-101",
    name: "Apple",
    uom: "kg",
    max_qty: 10,
    special_price: 80,
    special_from_date: "2026-01-01",
    special_to_date: "2026-01-31",
    price_range: {
      minimum_price: {
        regular_price: { value: 100, currency: "PHP" },
        final_price: { value: 80, currency: "PHP" },
        discount: { percent_off: 20, amount_off: 20 },
      },
    },
    small_image: { url: "https://cdn.example/a.jpg" },
    product_link: "https://smmarkets.ph/apple",
    url_key: "apple",
    __typename: "SimpleProduct",
    ...overrides,
  };
}

export function makeProduct(overrides: Partial<NormalizedProduct> = {}): NormalizedProduct {
  const base: Omit<NormalizedProduct, "content_hash"> = {
    source: "smmarkets-graphql",
    store_context: "SM_MARKETS_ONLINE",
    category_id: "2398",
    product_id: "101",
    uid: "uid-101",
    sku: "SKU-101",
    product_name: "Apple",
    product_type: "SimpleProduct",
    uom: "kg",
    max_qty: 10,
    regular_price_php: 100,
    price_php: 80,
    currency: "PHP",
    special_price: 80,
    special_from_date: "2026-01-01",
    special_to_date: "2026-01-31",
    discount_percent: 20,
    discount_amount: 20,
    image_url: "https://cdn.example/a.jpg",
    product_url: "https://smmarkets.ph/apple",
    last_seen_at: "2026-09-16T05:00:00.000Z",
    ...overrides,
  };
  return {
    ...base,
    content_hash: overrides.content_hash ?? contentHash(base),
  };
}

export const requiredEnv = {
  SM_GRAPHQL_URL: "https://smmarkets.ph/graphql",
  SM_CATEGORY_ID: "2398",
  STORE_CONTEXT: "SM_MARKETS_ONLINE",
  SPREADSHEET_ID: "sheet-id",
  GOOGLE_SERVICE_ACCOUNT_JSON: "{}",
};
