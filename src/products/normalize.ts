import type { AppConfig } from "../config";
import type { SourceProduct } from "../graphql/schemas";
import { contentHash } from "./hash";
import { stableProductKey, type NormalizedProduct } from "./types";

export function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function blankToEmpty(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

export function deriveProductId(item: SourceProduct): string {
  const id = blankToEmpty(item.id);
  if (id) {
    return id;
  }
  const uid = blankToEmpty(item.uid);
  if (uid) {
    return uid;
  }
  return blankToEmpty(item.sku);
}

const SAFE_URL_KEY = /^[a-zA-Z0-9/_-]+$/;

export function deriveProductUrl(item: SourceProduct, graphqlUrl: string): string {
  try {
    const origin = new URL(graphqlUrl).origin;
    const link = blankToEmpty(item.product_link);
    if (link) {
      return new URL(link, `${origin}/`).toString();
    }
    const urlKey = blankToEmpty(item.url_key);
    if (!urlKey || !SAFE_URL_KEY.test(urlKey)) {
      return "";
    }
    return `${origin}/${urlKey.replace(/^\/+/, "")}`;
  } catch {
    return blankToEmpty(item.product_link);
  }
}

export type NormalizeMeta = {
  source: string;
  storeContext: string;
  categoryId: string;
  graphqlUrl: string;
  lastSeenAt: string;
};

export function normalizeProduct(item: SourceProduct, meta: NormalizeMeta): NormalizedProduct | null {
  const productId = deriveProductId(item);
  if (!productId) {
    return null;
  }

  const minimum = item.price_range?.minimum_price;
  const regularPrice = toNumberOrNull(minimum?.regular_price?.value);
  const finalPrice = toNumberOrNull(minimum?.final_price?.value);
  const pricePhp = finalPrice ?? regularPrice;
  const currency = blankToEmpty(minimum?.final_price?.currency) || blankToEmpty(minimum?.regular_price?.currency);
  const productUrl = deriveProductUrl(item, meta.graphqlUrl);

  const draft: Omit<NormalizedProduct, "content_hash"> = {
    source: meta.source,
    store_context: meta.storeContext,
    category_id: meta.categoryId,
    product_id: productId,
    uid: blankToEmpty(item.uid),
    sku: blankToEmpty(item.sku),
    product_name: blankToEmpty(item.name),
    product_type: blankToEmpty(item.__typename),
    uom: blankToEmpty(item.uom),
    max_qty: toNumberOrNull(item.max_qty),
    regular_price_php: regularPrice,
    price_php: pricePhp,
    currency,
    special_price: toNumberOrNull(item.special_price),
    special_from_date: blankToEmpty(item.special_from_date),
    special_to_date: blankToEmpty(item.special_to_date),
    discount_percent: toNumberOrNull(minimum?.discount?.percent_off),
    discount_amount: toNumberOrNull(minimum?.discount?.amount_off),
    image_url: blankToEmpty(item.small_image?.url),
    product_url: productUrl,
    last_seen_at: meta.lastSeenAt,
  };

  return {
    ...draft,
    content_hash: contentHash(draft),
  };
}

export function normalizeProducts(
  items: SourceProduct[],
  config: AppConfig,
  lastSeenAt: string,
): { products: NormalizedProduct[]; skipped: number } {
  const products: NormalizedProduct[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  const meta: NormalizeMeta = {
    source: config.sourceName,
    storeContext: config.storeContext,
    categoryId: config.categoryId,
    graphqlUrl: config.graphqlUrl,
    lastSeenAt,
  };

  for (const item of items) {
    const product = normalizeProduct(item, meta);
    if (!product) {
      skipped += 1;
      continue;
    }
    const key = stableProductKey(product);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    products.push(product);
  }

  return { products, skipped };
}
