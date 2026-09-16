import { z } from "zod";
import { CrawlerError } from "./utils/errors";

const positiveInt = (name: string, fallback: number) =>
  z.preprocess((value) => {
    if (value === undefined || value === "") {
      return fallback;
    }
    return value;
  }, z.coerce.number().int().positive(`${name} must be a positive integer`));

const nonNegativeInt = (name: string, fallback: number) =>
  z.preprocess((value) => {
    if (value === undefined || value === "") {
      return fallback;
    }
    return value;
  }, z.coerce.number().int().min(0, `${name} must be >= 0`));

const envSchema = z.object({
  SM_GRAPHQL_URL: z.string().url("SM_GRAPHQL_URL must be a valid URL"),
  SM_CATEGORY_ID: z.string().min(1, "SM_CATEGORY_ID is required"),
  SM_PAGE_SIZE: positiveInt("SM_PAGE_SIZE", 100),
  MAX_PAGES_PER_RUN: positiveInt("MAX_PAGES_PER_RUN", 100),
  STORE_CONTEXT: z.string().min(1, "STORE_CONTEXT is required"),
  SOURCE_NAME: z.preprocess(
    (value) => (value === undefined || value === "" ? "smmarkets-graphql" : value),
    z.string().min(1),
  ),
  SPREADSHEET_ID: z.string().min(1, "SPREADSHEET_ID is required"),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().min(1, "GOOGLE_SERVICE_ACCOUNT_JSON is required"),
  CRON_SECRET: z.string().optional(),
  ALLOW_LOCAL_CRON: z.string().optional(),
  FETCH_TIMEOUT_MS: positiveInt("FETCH_TIMEOUT_MS", 20_000),
  MAX_FETCH_RETRIES: nonNegativeInt("MAX_FETCH_RETRIES", 2),
  CRAWLER_VERSION: z.string().optional(),
  MIN_SNAPSHOT_RATIO: z.preprocess((value) => {
    if (value === undefined || value === "") {
      return 0.5;
    }
    return value;
  }, z.coerce.number().gt(0).lte(1, "MIN_SNAPSHOT_RATIO must be between 0 exclusive and 1 inclusive")),
  VERCEL_ENV: z.string().optional(),
  VERCEL_GIT_COMMIT_SHA: z.string().optional(),
  NODE_ENV: z.string().optional(),
});

export type AppConfig = {
  graphqlUrl: string;
  categoryId: string;
  pageSize: number;
  maxPagesPerRun: number;
  storeContext: string;
  sourceName: string;
  spreadsheetId: string;
  googleServiceAccountJson: string;
  cronSecret: string | undefined;
  allowLocalCron: boolean;
  fetchTimeoutMs: number;
  maxFetchRetries: number;
  crawlerVersion: string;
  minSnapshotRatio: number;
  deploymentEnvironment: string;
  isProduction: boolean;
};

export type EnvLike = Record<string, string | undefined>;

export function loadConfig(env: EnvLike = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => issue.message).join("; ");
    throw new CrawlerError("CONFIG_INVALID", `Invalid configuration: ${details}`);
  }

  const data = parsed.data;
  const deploymentEnvironment = data.VERCEL_ENV || data.NODE_ENV || "development";
  const isProduction = data.VERCEL_ENV === "production" || data.NODE_ENV === "production";

  if (isProduction && !data.CRON_SECRET) {
    throw new CrawlerError("CONFIG_INVALID", "Invalid configuration: CRON_SECRET is required in production");
  }

  return {
    graphqlUrl: data.SM_GRAPHQL_URL,
    categoryId: data.SM_CATEGORY_ID,
    pageSize: data.SM_PAGE_SIZE,
    maxPagesPerRun: data.MAX_PAGES_PER_RUN,
    storeContext: data.STORE_CONTEXT,
    sourceName: data.SOURCE_NAME,
    spreadsheetId: data.SPREADSHEET_ID,
    googleServiceAccountJson: data.GOOGLE_SERVICE_ACCOUNT_JSON,
    cronSecret: data.CRON_SECRET || undefined,
    allowLocalCron: data.ALLOW_LOCAL_CRON === "true",
    fetchTimeoutMs: data.FETCH_TIMEOUT_MS,
    maxFetchRetries: data.MAX_FETCH_RETRIES,
    crawlerVersion: data.CRAWLER_VERSION || data.VERCEL_GIT_COMMIT_SHA || "dev",
    minSnapshotRatio: data.MIN_SNAPSHOT_RATIO,
    deploymentEnvironment,
    isProduction,
  };
}

export type CronAuthInput = {
  authorization?: string | null;
  vercelCron?: string | null;
  secretQuery?: string | null;
};

export function isCronAuthorized(input: CronAuthInput, config: AppConfig): boolean {
  const secret = config.cronSecret;
  const bearer = input.authorization?.trim();
  const querySecret = input.secretQuery?.trim();

  if (secret) {
    if (bearer === `Bearer ${secret}`) {
      return true;
    }
    if (querySecret === secret) {
      return true;
    }
  }

  if (config.allowLocalCron && !config.isProduction) {
    return true;
  }

  return false;
}
