import { describe, expect, it, vi } from "vitest";
import type { CrawlLogRow, HistoryEvent } from "../src/products/types";
import { parseServiceAccountJson, withSheetsRetry } from "../src/sheets/client";
import {
  CRAWL_LOG_COLUMNS,
  PRICE_HISTORY_COLUMNS,
  PRODUCTS_CURRENT_COLUMNS,
  crawlLogToRow,
  historyEventToRow,
  productToRow,
  rowToProduct,
} from "../src/sheets/columns";
import { CrawlerError } from "../src/utils/errors";
import { makeProduct } from "./helpers";

describe("sheet column order", () => {
  it("matches the PRD Products_Current order", () => {
    expect([...PRODUCTS_CURRENT_COLUMNS]).toEqual([
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
    ]);
  });

  it("maps a normalized product to that column order", () => {
    const product = makeProduct();
    const row = productToRow(product);
    expect(row).toEqual(PRODUCTS_CURRENT_COLUMNS.map((column) => product[column]));
    expect(rowToProduct(row, [...PRODUCTS_CURRENT_COLUMNS])).toEqual(product);
  });

  it("maps history and log rows in PRD order", () => {
    const event: HistoryEvent = {
      event_id: "e1",
      captured_at: "2026-09-16T05:00:31.000Z",
      run_id: "r1",
      event_type: "changed",
      source: "smmarkets-graphql",
      store_context: "SM_MARKETS_ONLINE",
      category_id: "2398",
      product_id: "101",
      sku: "SKU-101",
      product_name: "Apple",
      changed_fields: "price_php",
      old_price_php: 80,
      new_price_php: 70,
      old_regular_price_php: 100,
      new_regular_price_php: 100,
      old_special_price: 80,
      new_special_price: 70,
      old_max_qty: 10,
      new_max_qty: 10,
      old_content_hash: "abc",
      new_content_hash: "def",
    };
    expect(historyEventToRow(event)).toEqual(PRICE_HISTORY_COLUMNS.map((column) => event[column]));

    const log: CrawlLogRow = {
      run_id: "r1",
      started_at: "2026-09-16T05:00:00.000Z",
      finished_at: "2026-09-16T05:00:31.000Z",
      status: "success",
      source: "smmarkets-graphql",
      category_id: "2398",
      store_context: "SM_MARKETS_ONLINE",
      pages_fetched: 4,
      products_fetched: 284,
      products_written: 284,
      new_count: 3,
      changed_count: 12,
      removed_count: 1,
      http_status_summary: "200,200,200,200",
      error_code: "",
      error_message: "",
      deployment_environment: "production",
      crawler_version: "abc123",
    };
    expect(crawlLogToRow(log)).toEqual(CRAWL_LOG_COLUMNS.map((column) => log[column]));
  });

  it("writes null numerics as empty cells", () => {
    const product = makeProduct({ price_php: null, max_qty: null });
    const row = productToRow(product);
    expect(row[PRODUCTS_CURRENT_COLUMNS.indexOf("price_php")]).toBe("");
    expect(row[PRODUCTS_CURRENT_COLUMNS.indexOf("max_qty")]).toBe("");
  });
});

describe("service account parsing", () => {
  it("parses JSON and base64 credentials", () => {
    const json = JSON.stringify({ client_email: "sa@example.com", private_key: "key" });
    expect(parseServiceAccountJson(json).client_email).toBe("sa@example.com");
    expect(parseServiceAccountJson(Buffer.from(json, "utf8").toString("base64")).private_key).toBe("key");
  });

  it("does not include credential text in errors", () => {
    try {
      parseServiceAccountJson("super-secret-not-json");
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(CrawlerError);
      expect((error as Error).message).not.toContain("super-secret");
    }
  });
});

describe("sheets retry", () => {
  it("retries a transient 429 then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("quota"), { code: 429 }))
      .mockResolvedValueOnce("ok");
    const sleepFn = vi.fn(async () => undefined);
    await expect(withSheetsRetry(fn, 2, sleepFn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry authorization failures", async () => {
    const fn = vi.fn().mockRejectedValue(Object.assign(new Error("denied"), { code: 403 }));
    await expect(withSheetsRetry(fn, 2, async () => undefined)).rejects.toMatchObject({
      code: "SHEETS_AUTH_ERROR",
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
