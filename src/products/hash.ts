import { createHash } from "node:crypto";
import type { NormalizedProduct } from "./types";

export type HashInput = Pick<
  NormalizedProduct,
  | "product_id"
  | "product_name"
  | "uom"
  | "max_qty"
  | "regular_price_php"
  | "price_php"
  | "special_price"
  | "special_from_date"
  | "special_to_date"
  | "discount_percent"
  | "discount_amount"
  | "product_url"
>;

export function contentHash(input: HashInput): string {
  const payload = JSON.stringify([
    input.product_id,
    input.product_name,
    input.uom,
    input.max_qty,
    input.regular_price_php,
    input.price_php,
    input.special_price,
    input.special_from_date,
    input.special_to_date,
    input.discount_percent,
    input.discount_amount,
    input.product_url,
  ]);
  return createHash("sha256").update(payload).digest("hex");
}
