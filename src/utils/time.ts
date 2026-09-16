export function nowIso(date = new Date()): string {
  return date.toISOString();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function parseRetryAfter(header: string | null | undefined): number | undefined {
  if (!header) {
    return undefined;
  }
  const trimmed = header.trim();
  if (!trimmed) {
    return undefined;
  }
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 30_000);
  }
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    return Math.min(Math.max(dateMs - Date.now(), 0), 30_000);
  }
  return undefined;
}
