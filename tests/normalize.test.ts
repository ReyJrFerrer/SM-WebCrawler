import { describe, expect, it } from "vitest";
import { contentHash } from "../src/products/hash";
import {
  deriveProductId,
  deriveProductUrl,
  normalizeProduct,
  normalizeProducts,
} from "../src/products/normalize";
import { makeConfig, makeSourceProduct } from "./helpers";

const meta = {
  source: "smmarkets-graphql",
  storeContext: "SM_MARKETS_ONLINE",
  categoryId: "2398",
  graphqlUrl: "https://smmarkets.ph/graphql",
  lastSeenAt: "2026-09-16T05:00:00.000Z",
};

describe("deriveProductId", () => {
  it("prefers id, then uid, then sku", () => {
    expect(deriveProductId(makeSourceProduct({ id: "1", uid: "u", sku: "s" }))).toBe("1");
    expect(deriveProductId(makeSourceProduct({ id: "", uid: "u", sku: "s" }))).toBe("u");
    expect(deriveProductId(makeSourceProduct({ id: null, uid: "", sku: "s" }))).toBe("s");
    expect(deriveProductId(makeSourceProduct({ id: 42, uid: "u", sku: "s" }))).toBe("42");
  });

  it("returns empty when no usable key exists", () => {
    expect(deriveProductId(makeSourceProduct({ id: "", uid: "", sku: "" }))).toBe("");
    expect(deriveProductId(makeSourceProduct({ id: null, uid: null, sku: null }))).toBe("");
  });
});

describe("price selection", () => {
  it("uses final_price when present", () => {
    const product = normalizeProduct(makeSourceProduct(), meta);
    expect(product?.price_php).toBe(80);
    expect(product?.regular_price_php).toBe(100);
  });

  it("falls back to regular_price when final_price is missing", () => {
    const product = normalizeProduct(
      makeSourceProduct({
        price_range: {
          minimum_price: {
            regular_price: { value: 55, currency: "PHP" },
            final_price: { value: null, currency: "PHP" },
          },
        },
      }),
      meta,
    );
    expect(product?.price_php).toBe(55);
    expect(product?.regular_price_php).toBe(55);
  });

  it("normalizes absent numeric fields to null", () => {
    const product = normalizeProduct(
      makeSourceProduct({
        max_qty: null,
        special_price: null,
        price_range: {
          minimum_price: {
            regular_price: { value: null },
            final_price: { value: null },
            discount: { percent_off: null, amount_off: null },
          },
        },
      }),
      meta,
    );
    expect(product?.max_qty).toBeNull();
    expect(product?.special_price).toBeNull();
    expect(product?.price_php).toBeNull();
    expect(product?.regular_price_php).toBeNull();
    expect(product?.discount_percent).toBeNull();
    expect(product?.discount_amount).toBeNull();
  });
});

describe("product url", () => {
  it("prefers product_link", () => {
    expect(deriveProductUrl(makeSourceProduct(), meta.graphqlUrl)).toBe("https://smmarkets.ph/apple");
  });

  it("resolves a relative product_link against the store origin", () => {
    expect(
      deriveProductUrl(
        makeSourceProduct({ product_link: "2020371004-cream-o.html" }),
        meta.graphqlUrl,
      ),
    ).toBe("https://smmarkets.ph/2020371004-cream-o.html");
  });

  it("constructs a URL from a safe url_key", () => {
    expect(
      deriveProductUrl(
        makeSourceProduct({ product_link: "", url_key: "fresh-apple" }),
        meta.graphqlUrl,
      ),
    ).toBe("https://smmarkets.ph/fresh-apple");
  });

  it("does not construct a URL from an unsafe url_key", () => {
    expect(
      deriveProductUrl(
        makeSourceProduct({ product_link: "", url_key: "javascript:alert(1)" }),
        meta.graphqlUrl,
      ),
    ).toBe("");
  });
});

describe("normalizeProduct", () => {
  it("returns null when there is no stable key", () => {
    expect(normalizeProduct(makeSourceProduct({ id: "", uid: "", sku: "" }), meta)).toBeNull();
  });

  it("normalizes blank optional strings to empty strings", () => {
    const product = normalizeProduct(
      makeSourceProduct({ uom: null, name: "  Apple  ", small_image: { url: null } }),
      meta,
    );
    expect(product?.uom).toBe("");
    expect(product?.product_name).toBe("Apple");
    expect(product?.image_url).toBe("");
  });

  it("adds source metadata and a deterministic content hash", () => {
    const product = normalizeProduct(makeSourceProduct(), meta);
    expect(product?.source).toBe("smmarkets-graphql");
    expect(product?.store_context).toBe("SM_MARKETS_ONLINE");
    expect(product?.category_id).toBe("2398");
    expect(product?.last_seen_at).toBe(meta.lastSeenAt);
    expect(product?.content_hash).toBe(contentHash(product!));
    expect(contentHash(product!)).toBe(contentHash(product!));
  });
});

describe("normalizeProducts", () => {
  it("skips items without keys and de-duplicates by stable key", () => {
    const result = normalizeProducts(
      [
        makeSourceProduct({ id: "1", name: "First" }),
        makeSourceProduct({ id: "1", name: "Duplicate" }),
        makeSourceProduct({ id: "", uid: "", sku: "" }),
      ],
      makeConfig(),
      meta.lastSeenAt,
    );
    expect(result.skipped).toBe(1);
    expect(result.products).toHaveLength(1);
    expect(result.products[0]?.product_name).toBe("First");
  });
});
