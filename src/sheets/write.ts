import type { AppConfig } from "../config";
import type { CrawlLogRow, HistoryEvent, NormalizedProduct } from "../products/types";
import { CrawlerError } from "../utils/errors";
import { type SheetsApi, withSheetsRetry } from "./client";
import {
  CRAWL_LOG_COLUMNS,
  CRAWL_LOG_TAB,
  PRICE_HISTORY_COLUMNS,
  PRICE_HISTORY_TAB,
  PRODUCTS_CURRENT_COLUMNS,
  PRODUCTS_CURRENT_TAB,
  crawlLogToRow,
  headersMatch,
  historyEventToRow,
  productToRow,
  type SheetCell,
} from "./columns";

async function readHeader(options: {
  sheets: SheetsApi;
  spreadsheetId: string;
  tab: string;
  columns: readonly string[];
  maxRetries: number;
  sleepFn?: (ms: number) => Promise<void>;
}): Promise<unknown[]> {
  const lastCol = String.fromCharCode("A".charCodeAt(0) + options.columns.length - 1);
  const response = await withSheetsRetry(
    () =>
      options.sheets.spreadsheets.values.get({
        spreadsheetId: options.spreadsheetId,
        range: `${options.tab}!A1:${lastCol}1`,
      }),
    options.maxRetries,
    options.sleepFn,
  );
  return response.data.values?.[0] ?? [];
}

async function writeHeader(options: {
  sheets: SheetsApi;
  spreadsheetId: string;
  tab: string;
  columns: readonly string[];
  maxRetries: number;
  sleepFn?: (ms: number) => Promise<void>;
}): Promise<void> {
  const lastCol = String.fromCharCode("A".charCodeAt(0) + options.columns.length - 1);
  await withSheetsRetry(
    () =>
      options.sheets.spreadsheets.values.update({
        spreadsheetId: options.spreadsheetId,
        range: `${options.tab}!A1:${lastCol}1`,
        valueInputOption: "RAW",
        requestBody: { values: [[...options.columns]] },
      }),
    options.maxRetries,
    options.sleepFn,
  );
}

export async function ensureTabHeaders(options: {
  config: AppConfig;
  sheets: SheetsApi;
  sleepFn?: (ms: number) => Promise<void>;
}): Promise<void> {
  const tabs = [
    { tab: PRODUCTS_CURRENT_TAB, columns: PRODUCTS_CURRENT_COLUMNS },
    { tab: PRICE_HISTORY_TAB, columns: PRICE_HISTORY_COLUMNS },
    { tab: CRAWL_LOG_TAB, columns: CRAWL_LOG_COLUMNS },
  ] as const;

  for (const tab of tabs) {
    const header = await readHeader({
      sheets: options.sheets,
      spreadsheetId: options.config.spreadsheetId,
      tab: tab.tab,
      columns: tab.columns,
      maxRetries: options.config.maxFetchRetries,
      sleepFn: options.sleepFn,
    });
    if (header.length === 0 || header.every((cell) => cell === undefined || cell === null || String(cell).trim() === "")) {
      await writeHeader({
        sheets: options.sheets,
        spreadsheetId: options.config.spreadsheetId,
        tab: tab.tab,
        columns: tab.columns,
        maxRetries: options.config.maxFetchRetries,
        sleepFn: options.sleepFn,
      });
      continue;
    }
    if (!headersMatch(header, tab.columns)) {
      throw new CrawlerError(
        "SHEETS_HEADER_MISMATCH",
        `${tab.tab} header row does not match the expected column order`,
      );
    }
  }
}

export async function replaceCurrentSnapshot(options: {
  config: AppConfig;
  sheets: SheetsApi;
  existing: NormalizedProduct[];
  snapshot: NormalizedProduct[];
  sleepFn?: (ms: number) => Promise<void>;
}): Promise<void> {
  const context = {
    source: options.config.sourceName,
    store_context: options.config.storeContext,
    category_id: options.config.categoryId,
  };
  const others = options.existing.filter(
    (product) =>
      !(
        product.source === context.source &&
        product.store_context === context.store_context &&
        product.category_id === context.category_id
      ),
  );
  const next = [...others, ...options.snapshot];
  const rows: SheetCell[][] = next.map(productToRow);
  const lastCol = String.fromCharCode("A".charCodeAt(0) + PRODUCTS_CURRENT_COLUMNS.length - 1);

  await withSheetsRetry(
    () =>
      options.sheets.spreadsheets.values.clear({
        spreadsheetId: options.config.spreadsheetId,
        range: `${PRODUCTS_CURRENT_TAB}!A2:${lastCol}`,
      }),
    options.config.maxFetchRetries,
    options.sleepFn,
  );

  if (rows.length === 0) {
    return;
  }

  await withSheetsRetry(
    () =>
      options.sheets.spreadsheets.values.update({
        spreadsheetId: options.config.spreadsheetId,
        range: `${PRODUCTS_CURRENT_TAB}!A2`,
        valueInputOption: "RAW",
        requestBody: { values: rows },
      }),
    options.config.maxFetchRetries,
    options.sleepFn,
  );
}

export async function appendHistory(options: {
  config: AppConfig;
  sheets: SheetsApi;
  events: HistoryEvent[];
  sleepFn?: (ms: number) => Promise<void>;
}): Promise<void> {
  if (options.events.length === 0) {
    return;
  }
  const values = options.events.map(historyEventToRow);
  await withSheetsRetry(
    () =>
      options.sheets.spreadsheets.values.append({
        spreadsheetId: options.config.spreadsheetId,
        range: `${PRICE_HISTORY_TAB}!A:U`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values },
      }),
    options.config.maxFetchRetries,
    options.sleepFn,
  );
}

export async function appendCrawlLog(options: {
  config: AppConfig;
  sheets: SheetsApi;
  row: CrawlLogRow;
  sleepFn?: (ms: number) => Promise<void>;
}): Promise<void> {
  await withSheetsRetry(
    () =>
      options.sheets.spreadsheets.values.append({
        spreadsheetId: options.config.spreadsheetId,
        range: `${CRAWL_LOG_TAB}!A:R`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [crawlLogToRow(options.row)] },
      }),
    options.config.maxFetchRetries,
    options.sleepFn,
  );
}
