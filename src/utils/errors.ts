export class CrawlerError extends Error {
  readonly code: string;
  readonly httpStatus: number | undefined;
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;

  constructor(
    code: string,
    message: string,
    options: {
      httpStatus?: number;
      retryable?: boolean;
      retryAfterMs?: number;
      cause?: unknown;
    } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "CrawlerError";
    this.code = code;
    this.httpStatus = options.httpStatus;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs;
  }
}

const SECRET_HINT =
  /service_account|private_key|BEGIN PRIVATE|CRON_SECRET|client_email|GOOGLE_SERVICE_ACCOUNT|Bearer\s+\S+/i;

export function sanitizeErrorMessage(message: string, maxLen = 500): string {
  const withoutBearer = message.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
  const safe = SECRET_HINT.test(withoutBearer)
    ? "Redacted error message"
    : withoutBearer;
  return safe.length > maxLen ? `${safe.slice(0, maxLen)}…` : safe;
}

export function errorCodeOf(error: unknown): string {
  if (error instanceof CrawlerError) {
    return error.code;
  }
  return "UNKNOWN";
}

export function errorMessageOf(error: unknown): string {
  if (error instanceof Error) {
    return sanitizeErrorMessage(error.message);
  }
  return sanitizeErrorMessage(String(error));
}
