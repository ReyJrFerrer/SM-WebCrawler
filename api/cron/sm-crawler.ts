import { randomUUID } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isCronAuthorized, loadConfig } from "../../src/config";
import { runCrawl } from "../../src/crawler/run";
import { errorCodeOf, errorMessageOf } from "../../src/utils/errors";
import { nowIso } from "../../src/utils/time";

export const config = {
  maxDuration: 60,
};

function headerValue(req: VercelRequest, name: string): string | null {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function queryValue(req: VercelRequest, name: string): string | null {
  const value = req.query[name];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

export function readCronAuth(req: VercelRequest) {
  return {
    authorization: headerValue(req, "authorization"),
    vercelCron: headerValue(req, "x-vercel-cron"),
    secretQuery: queryValue(req, "secret"),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const runId = randomUUID();
  const startedAt = nowIso();

  if (req.method !== "GET") {
    res.status(405).json({
      ok: false,
      runId,
      status: "failed",
      error: { code: "METHOD_NOT_ALLOWED", message: "GET required" },
    });
    return;
  }

  let appConfig;
  try {
    appConfig = loadConfig();
  } catch (error) {
    res.status(500).json({
      ok: false,
      runId,
      status: "failed",
      error: { code: errorCodeOf(error), message: errorMessageOf(error) },
    });
    return;
  }

  if (!isCronAuthorized(readCronAuth(req), appConfig)) {
    res.status(401).json({
      ok: false,
      runId,
      status: "unauthorized",
      error: { code: "UNAUTHORIZED", message: "Unauthorized" },
    });
    return;
  }

  try {
    const summary = await runCrawl({ config: appConfig, runId, startedAt });
    const statusCode = summary.status === "failed" ? 500 : 200;
    if (summary.ok) {
      res.status(statusCode).json({
        ok: true,
        runId: summary.runId,
        status: summary.status,
        categoryId: summary.categoryId,
        pagesFetched: summary.pagesFetched,
        productsFetched: summary.productsFetched,
        productsWritten: summary.productsWritten,
        newCount: summary.newCount,
        changedCount: summary.changedCount,
        removedCount: summary.removedCount,
        finishedAt: summary.finishedAt,
      });
      return;
    }

    res.status(statusCode).json({
      ok: false,
      runId: summary.runId,
      status: summary.status,
      error: summary.error ?? { code: "UNKNOWN", message: "Crawl failed" },
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      runId,
      status: "failed",
      error: { code: errorCodeOf(error), message: errorMessageOf(error) },
    });
  }
}
