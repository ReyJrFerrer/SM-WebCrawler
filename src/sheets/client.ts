import { google, type sheets_v4 } from "googleapis";
import { CrawlerError } from "../utils/errors";
import { withRetry } from "../utils/retry";

export type SheetsApi = sheets_v4.Sheets;

type ServiceAccount = {
  client_email?: string;
  private_key?: string;
};

export function parseServiceAccountJson(raw: string): ServiceAccount {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new CrawlerError("SHEETS_AUTH_ERROR", "Google service account credentials are empty");
  }

  const tryParse = (text: string): ServiceAccount | null => {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === "object") {
        return parsed as ServiceAccount;
      }
      return null;
    } catch {
      return null;
    }
  };

  const direct = tryParse(trimmed);
  if (direct) {
    return direct;
  }

  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf8");
    const parsed = tryParse(decoded);
    if (parsed) {
      return parsed;
    }
  } catch {
    throw new CrawlerError("SHEETS_AUTH_ERROR", "Google service account credentials are invalid");
  }

  throw new CrawlerError("SHEETS_AUTH_ERROR", "Google service account credentials are invalid");
}

export function createSheetsApi(credentialsJson: string): SheetsApi {
  const credentials = parseServiceAccountJson(credentialsJson);
  const email = credentials.client_email;
  const key = credentials.private_key?.replace(/\\n/g, "\n");
  if (!email || !key) {
    throw new CrawlerError("SHEETS_AUTH_ERROR", "Google service account credentials are incomplete");
  }

  try {
    const auth = new google.auth.JWT({
      email,
      key,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    return google.sheets({ version: "v4", auth });
  } catch {
    throw new CrawlerError("SHEETS_AUTH_ERROR", "Failed to initialize Google Sheets authentication");
  }
}

function sheetsStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  if ("code" in error && typeof error.code === "number") {
    return error.code;
  }
  if (
    "response" in error &&
    error.response &&
    typeof error.response === "object" &&
    "status" in error.response &&
    typeof error.response.status === "number"
  ) {
    return error.response.status;
  }
  return undefined;
}

export function isRetryableSheetsError(error: unknown): boolean {
  const status = sheetsStatus(error);
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export async function withSheetsRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  sleepFn?: (ms: number) => Promise<void>,
): Promise<T> {
  try {
    return await withRetry(fn, {
      maxRetries,
      isRetryable: isRetryableSheetsError,
      sleepFn,
    });
  } catch (error) {
    const status = sheetsStatus(error);
    if (status === 401 || status === 403) {
      throw new CrawlerError("SHEETS_AUTH_ERROR", "Google Sheets authorization failed", {
        httpStatus: status,
      });
    }
    if (error instanceof CrawlerError) {
      throw error;
    }
    throw new CrawlerError("SHEETS_ERROR", "Google Sheets request failed", {
      httpStatus: status,
      retryable: isRetryableSheetsError(error),
      cause: error,
    });
  }
}
