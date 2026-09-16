import type { VercelRequest, VercelResponse } from "@vercel/node";
import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "../api/cron/sm-crawler";
import { isCronAuthorized, loadConfig } from "../src/config";
import { runCrawl, type CrawlerDependencies } from "../src/crawler/run";
import type { FetchAllProductsResult } from "../src/graphql/client";
import { CrawlerError } from "../src/utils/errors";
import { makeConfig, makeProduct, makeSourceProduct, requiredEnv } from "./helpers";

function mockReq(overrides: Partial<VercelRequest> = {}): VercelRequest {
  return {
    method: "GET",
    headers: {},
    query: {},
    ...overrides,
  } as VercelRequest;
}

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as VercelResponse & { statusCode: number; body: unknown };
}

describe("loadConfig", () => {
  it("applies defaults", () => {
    const config = loadConfig(requiredEnv);
    expect(config.pageSize).toBe(100);
    expect(config.maxPagesPerRun).toBe(100);
    expect(config.sourceName).toBe("smmarkets-graphql");
    expect(config.fetchTimeoutMs).toBe(20_000);
    expect(config.maxFetchRetries).toBe(2);
    expect(config.minSnapshotRatio).toBe(0.5);
    expect(config.crawlerVersion).toBe("dev");
  });

  it("fails fast on missing required values without leaking secrets", () => {
    try {
      loadConfig({ GOOGLE_SERVICE_ACCOUNT_JSON: "secret-json" });
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(CrawlerError);
      expect((error as CrawlerError).code).toBe("CONFIG_INVALID");
      expect((error as Error).message).toContain("Invalid configuration");
      expect((error as Error).message).not.toContain("secret-json");
    }
  });

  it("requires CRON_SECRET in production", () => {
    expect(() => loadConfig({ ...requiredEnv, NODE_ENV: "production" })).toThrow(/CRON_SECRET/);
  });
});

describe("cron authorization", () => {
  it("accepts a bearer secret", () => {
    const config = makeConfig({ isProduction: true, cronSecret: "abc", allowLocalCron: false });
    expect(isCronAuthorized({ authorization: "Bearer abc" }, config)).toBe(true);
    expect(isCronAuthorized({ authorization: "Bearer nope" }, config)).toBe(false);
    expect(isCronAuthorized({ secretQuery: "abc" }, config)).toBe(true);
  });

  it("allows local bypass only outside production", () => {
    expect(
      isCronAuthorized({}, makeConfig({ isProduction: false, allowLocalCron: true, cronSecret: undefined })),
    ).toBe(true);
    expect(
      isCronAuthorized({}, makeConfig({ isProduction: true, allowLocalCron: true, cronSecret: "abc" })),
    ).toBe(false);
  });

  it("does not treat a user-agent as authorization", () => {
    const config = makeConfig({ isProduction: true, allowLocalCron: false });
    expect(isCronAuthorized({ authorization: "vercel-cron/1.0" }, config)).toBe(false);
  });
});

describe("cron handler", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("rejects unauthorized production requests before crawling", async () => {
    Object.assign(process.env, requiredEnv, {
      NODE_ENV: "production",
      CRON_SECRET: "abc",
      ALLOW_LOCAL_CRON: "true",
    });
    const res = mockRes();
    await handler(mockReq({ headers: { "user-agent": "vercel-cron" } }), res);
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ ok: false, status: "unauthorized" });
  });

  it("returns 405 for non-GET requests", async () => {
    const res = mockRes();
    await handler(mockReq({ method: "POST" }), res);
    expect(res.statusCode).toBe(405);
  });
});

function mockDeps(
  overrides: Partial<Pick<CrawlerDependencies, "fetchAllProducts" | "readCurrentProducts" | "ensureHeaders">> = {},
) {
  return {
    fetchAllProducts: async () =>
      ({
        items: [makeSourceProduct()],
        pagesFetched: 1,
        productsFetched: 1,
        httpStatusSummary: "200",
        complete: true,
      }) satisfies FetchAllProductsResult,
    ensureHeaders: async () => undefined,
    readCurrentProducts: async () => [],
    replaceCurrentSnapshot: vi.fn(async () => undefined),
    appendHistory: vi.fn(async () => undefined),
    appendLog: vi.fn(async () => undefined),
    uuid: () => "event-1",
    now: () => "2026-09-16T05:00:31.000Z",
    ...overrides,
  };
}

describe("runCrawl", () => {
  it("writes snapshot, history, and log on a successful full run", async () => {
    const deps = mockDeps();
    const summary = await runCrawl({
      config: makeConfig(),
      runId: "run-1",
      startedAt: "2026-09-16T05:00:00.000Z",
      deps,
    });
    expect(summary).toMatchObject({
      ok: true,
      status: "success",
      productsWritten: 1,
      newCount: 1,
      changedCount: 0,
      removedCount: 0,
    });
    expect(deps.replaceCurrentSnapshot).toHaveBeenCalledTimes(1);
    expect(deps.appendHistory).toHaveBeenCalledTimes(1);
    expect(deps.appendLog).toHaveBeenCalledTimes(1);
    expect(deps.appendLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "success" }),
    );
  });

  it("does not replace the snapshot on a partial source run", async () => {
    const deps = mockDeps({
      fetchAllProducts: async () => ({
        items: [makeSourceProduct()],
        pagesFetched: 1,
        productsFetched: 1,
        httpStatusSummary: "200",
        complete: false,
        errorCode: "MAX_PAGES_EXCEEDED",
        errorMessage: "limit",
      }),
    });
    const summary = await runCrawl({
      config: makeConfig(),
      runId: "run-1",
      startedAt: "2026-09-16T05:00:00.000Z",
      deps,
    });
    expect(summary.status).toBe("partial");
    expect(summary.ok).toBe(false);
    expect(deps.replaceCurrentSnapshot).not.toHaveBeenCalled();
    expect(deps.appendHistory).not.toHaveBeenCalled();
    expect(deps.appendLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "partial" }),
    );
  });

  it("does not infer removals or overwrite on an implausible snapshot", async () => {
    const previous = Array.from({ length: 120 }, (_, index) =>
      makeProduct({ product_id: `p${index}` }),
    );
    const deps = mockDeps({
      readCurrentProducts: async () => previous,
    });
    const summary = await runCrawl({
      config: makeConfig({ minSnapshotRatio: 0.5 }),
      runId: "run-1",
      startedAt: "2026-09-16T05:00:00.000Z",
      deps,
    });
    expect(summary.status).toBe("partial");
    expect(summary.error?.code).toBe("SNAPSHOT_IMPLAUSIBLE");
    expect(deps.replaceCurrentSnapshot).not.toHaveBeenCalled();
    expect(deps.appendHistory).not.toHaveBeenCalled();
  });

  it("logs a GraphQL failure and does not write the current snapshot", async () => {
    const deps = mockDeps({
      fetchAllProducts: async () => {
        throw new CrawlerError("SOURCE_GRAPHQL_ERROR", "GraphQL returned an error response.");
      },
    });
    const summary = await runCrawl({
      config: makeConfig(),
      runId: "run-1",
      startedAt: "2026-09-16T05:00:00.000Z",
      deps,
    });
    expect(summary).toMatchObject({
      ok: false,
      status: "failed",
      error: { code: "SOURCE_GRAPHQL_ERROR" },
    });
    expect(deps.replaceCurrentSnapshot).not.toHaveBeenCalled();
    expect(deps.appendLog).toHaveBeenCalledTimes(1);
    expect(deps.appendLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "failed" }),
    );
  });
});
