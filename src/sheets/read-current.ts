import type { AppConfig } from "../config";
import type { NormalizedProduct } from "../products/types";
import { CrawlerError } from "../utils/errors";
import { type SheetsApi, withSheetsRetry } from "./client";
import {
  PRODUCTS_CURRENT_COLUMNS,
  PRODUCTS_CURRENT_TAB,
  headersMatch,
  rowToProduct,
} from "./columns";

export async function readCurrentProducts(options: {
  config: AppConfig;
  sheets: SheetsApi;
  sleepFn?: (ms: number) => Promise<void>;
}): Promise<{ headers: string[]; products: NormalizedProduct[] }> {
  const range = `${PRODUCTS_CURRENT_TAB}!A1:V`;
  const response = await withSheetsRetry(
    () =>
      options.sheets.spreadsheets.values.get({
        spreadsheetId: options.config.spreadsheetId,
        range,
        valueRenderOption: "UNFORMATTED_VALUE",
      }),
    options.config.maxFetchRetries,
    options.sleepFn,
  );

  const values = response.data.values ?? [];
  if (values.length === 0) {
    return { headers: [...PRODUCTS_CURRENT_COLUMNS], products: [] };
  }

  const headerRow = values[0] ?? [];
  if (!headersMatch(headerRow, PRODUCTS_CURRENT_COLUMNS)) {
    if (headerRow.every((cell) => cell === undefined || cell === null || String(cell).trim() === "")) {
      return { headers: [...PRODUCTS_CURRENT_COLUMNS], products: [] };
    }
    throw new CrawlerError(
      "SHEETS_HEADER_MISMATCH",
      "Products_Current header row does not match the expected column order",
    );
  }

  const headers = PRODUCTS_CURRENT_COLUMNS.map(String);
  const products: NormalizedProduct[] = [];
  for (const row of values.slice(1)) {
    const product = rowToProduct(row ?? [], headers);
    if (product) {
      products.push(product);
    }
  }
  return { headers, products };
}
