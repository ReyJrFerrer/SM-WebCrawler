import type { CrawlLogRow, HistoryEvent, NormalizedProduct } from "../products/types";

export const PRODUCTS_CURRENT_TAB = "Products_Current";
export const PRICE_HISTORY_TAB = "Price_History";
export const CRAWL_LOG_TAB = "Crawl_Log";

export const PRODUCTS_CURRENT_COLUMNS = [
  "source",
  "store_context",
  "category_id",
  "product_id",
  "uid",
  "sku",
  "product_name",
  "product_type",
  "uom",
  "max_qty",
  "regular_price_php",
  "price_php",
  "currency",
  "special_price",
  "special_from_date",
  "special_to_date",
  "discount_percent",
  "discount_amount",
  "image_url",
  "product_url",
  "last_seen_at",
  "content_hash",
] as const;

export const PRICE_HISTORY_COLUMNS = [
  "event_id",
  "captured_at",
  "run_id",
  "event_type",
  "source",
  "store_context",
  "category_id",
  "product_id",
  "sku",
  "product_name",
  "changed_fields",
  "old_price_php",
  "new_price_php",
  "old_regular_price_php",
  "new_regular_price_php",
  "old_special_price",
  "new_special_price",
  "old_max_qty",
  "new_max_qty",
  "old_content_hash",
  "new_content_hash",
] as const;

export const CRAWL_LOG_COLUMNS = [
  "run_id",
  "started_at",
  "finished_at",
  "status",
  "source",
  "category_id",
  "store_context",
  "pages_fetched",
  "products_fetched",
  "products_written",
  "new_count",
  "changed_count",
  "removed_count",
  "http_status_summary",
  "error_code",
  "error_message",
  "deployment_environment",
  "crawler_version",
] as const;

export type SheetCell = string | number | boolean;

function cell(value: string | number | null | undefined): SheetCell {
  if (value === null || value === undefined) {
    return "";
  }
  return value;
}

export function productToRow(product: NormalizedProduct): SheetCell[] {
  return PRODUCTS_CURRENT_COLUMNS.map((column) => cell(product[column]));
}

export function historyEventToRow(event: HistoryEvent): SheetCell[] {
  return PRICE_HISTORY_COLUMNS.map((column) => cell(event[column]));
}

export function crawlLogToRow(row: CrawlLogRow): SheetCell[] {
  return CRAWL_LOG_COLUMNS.map((column) => cell(row[column]));
}

export function columnIndexMap(headers: string[]): Map<string, number> {
  const map = new Map<string, number>();
  headers.forEach((header, index) => {
    map.set(header.trim(), index);
  });
  return map;
}

function str(row: unknown[], index: number | undefined): string {
  if (index === undefined) {
    return "";
  }
  const value = row[index];
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function num(row: unknown[], index: number | undefined): number | null {
  if (index === undefined) {
    return null;
  }
  const value = row[index];
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function rowToProduct(row: unknown[], headers: string[]): NormalizedProduct | null {
  const idx = columnIndexMap(headers);
  const productId = str(row, idx.get("product_id"));
  if (!productId) {
    return null;
  }
  return {
    source: str(row, idx.get("source")),
    store_context: str(row, idx.get("store_context")),
    category_id: str(row, idx.get("category_id")),
    product_id: productId,
    uid: str(row, idx.get("uid")),
    sku: str(row, idx.get("sku")),
    product_name: str(row, idx.get("product_name")),
    product_type: str(row, idx.get("product_type")),
    uom: str(row, idx.get("uom")),
    max_qty: num(row, idx.get("max_qty")),
    regular_price_php: num(row, idx.get("regular_price_php")),
    price_php: num(row, idx.get("price_php")),
    currency: str(row, idx.get("currency")),
    special_price: num(row, idx.get("special_price")),
    special_from_date: str(row, idx.get("special_from_date")),
    special_to_date: str(row, idx.get("special_to_date")),
    discount_percent: num(row, idx.get("discount_percent")),
    discount_amount: num(row, idx.get("discount_amount")),
    image_url: str(row, idx.get("image_url")),
    product_url: str(row, idx.get("product_url")),
    last_seen_at: str(row, idx.get("last_seen_at")),
    content_hash: str(row, idx.get("content_hash")),
  };
}

export function headersMatch(actual: unknown[], expected: readonly string[]): boolean {
  if (actual.length < expected.length) {
    return false;
  }
  return expected.every((name, index) => String(actual[index] ?? "").trim() === name);
}
