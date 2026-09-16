export type NormalizedProduct = {
  source: string;
  store_context: string;
  category_id: string;
  product_id: string;
  uid: string;
  sku: string;
  product_name: string;
  product_type: string;
  uom: string;
  max_qty: number | null;
  regular_price_php: number | null;
  price_php: number | null;
  currency: string;
  special_price: number | null;
  special_from_date: string;
  special_to_date: string;
  discount_percent: number | null;
  discount_amount: number | null;
  image_url: string;
  product_url: string;
  last_seen_at: string;
  content_hash: string;
};

export const TRACKED_CHANGE_FIELDS = [
  "product_name",
  "uom",
  "price_php",
  "regular_price_php",
  "special_price",
  "discount_percent",
  "max_qty",
  "product_url",
] as const;

export type TrackedChangeField = (typeof TRACKED_CHANGE_FIELDS)[number];

export type HistoryEventType = "new" | "changed" | "removed";

export type HistoryEvent = {
  event_id: string;
  captured_at: string;
  run_id: string;
  event_type: HistoryEventType;
  source: string;
  store_context: string;
  category_id: string;
  product_id: string;
  sku: string;
  product_name: string;
  changed_fields: string;
  old_price_php: number | null;
  new_price_php: number | null;
  old_regular_price_php: number | null;
  new_regular_price_php: number | null;
  old_special_price: number | null;
  new_special_price: number | null;
  old_max_qty: number | null;
  new_max_qty: number | null;
  old_content_hash: string;
  new_content_hash: string;
};

export type CrawlStatus = "success" | "partial" | "failed" | "unauthorized";

export type CrawlLogRow = {
  run_id: string;
  started_at: string;
  finished_at: string;
  status: CrawlStatus;
  source: string;
  category_id: string;
  store_context: string;
  pages_fetched: number;
  products_fetched: number;
  products_written: number;
  new_count: number;
  changed_count: number;
  removed_count: number;
  http_status_summary: string;
  error_code: string;
  error_message: string;
  deployment_environment: string;
  crawler_version: string;
};

export function stableProductKey(product: Pick<NormalizedProduct, "source" | "store_context" | "category_id" | "product_id">): string {
  return `${product.source}|${product.store_context}|${product.category_id}|${product.product_id}`;
}
