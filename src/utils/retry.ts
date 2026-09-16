import { CrawlerError } from "./errors";
import { sleep } from "./time";

export type RetryOptions = {
  maxRetries: number;
  isRetryable: (error: unknown) => boolean;
  getRetryAfterMs?: (error: unknown) => number | undefined;
  sleepFn?: (ms: number) => Promise<void>;
  random?: () => number;
};

function defaultDelayMs(attempt: number, random: () => number): number {
  const base = Math.min(1000 * 2 ** attempt, 15_000);
  const jitter = Math.floor(random() * 250);
  return base + jitter;
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const sleepFn = options.sleepFn ?? sleep;
  const random = options.random ?? Math.random;
  let lastError: unknown;

  for (let attempt = 0; attempt <= options.maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const retryable = options.isRetryable(error);
      if (!retryable || attempt >= options.maxRetries) {
        throw error;
      }
      const hinted =
        options.getRetryAfterMs?.(error) ??
        (error instanceof CrawlerError ? error.retryAfterMs : undefined);
      const delay = hinted ?? defaultDelayMs(attempt, random);
      await sleepFn(delay);
    }
  }

  throw lastError;
}
