# SM Markets Catalog-to-Google-Sheets Crawler

Scheduled, read-only collector that pulls one SM Markets category from the public storefront GraphQL endpoint, normalizes products, and syncs them to Google Sheets.

- Current snapshot: `Products_Current`
- Change events: `Price_History` (`new`, `changed`, `removed`)
- Every attempt: one `Crawl_Log` row

This project is for internal monitoring. Keep the schedule low-frequency, respect SM Markets terms and access controls, and do not bypass authentication, CAPTCHAs, or rate limits.

## Stack

- Node.js 20+ / TypeScript
- Vercel Cron (`GET /api/cron/sm-crawler`)
- `googleapis` + service account
- Zod validation, Vitest tests
- Package manager: Bun

## Setup

```bash
bun install
cp .env.example .env
```

Fill in `.env` using the variables below. Never commit credentials.

### Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `SM_GRAPHQL_URL` | Yes | | GraphQL endpoint, e.g. `https://smmarkets.ph/graphql` |
| `SM_CATEGORY_ID` | Yes | | Category to crawl |
| `SM_PAGE_SIZE` | No | `100` | Page size |
| `MAX_PAGES_PER_RUN` | No | `100` | Pagination circuit breaker |
| `STORE_CONTEXT` | Yes | | Logical store label, e.g. `SM_MARKETS_ONLINE` |
| `SOURCE_NAME` | No | `smmarkets-graphql` | Source identifier |
| `SPREADSHEET_ID` | Yes | | Destination spreadsheet ID |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Yes | | Service-account JSON string or base64 JSON |
| `CRON_SECRET` | Yes in production | | Bearer secret for the cron route |
| `ALLOW_LOCAL_CRON` | No | | `true` enables local unauthenticated runs (ignored in production) |
| `FETCH_TIMEOUT_MS` | No | `20000` | Source request timeout |
| `MAX_FETCH_RETRIES` | No | `2` | Bounded retries for retryable HTTP/Sheets errors |
| `MIN_SNAPSHOT_RATIO` | No | `0.5` | Abort snapshot replace if count drops below this ratio of the previous count (when previous ≥ 100) |
| `CRAWLER_VERSION` | No | `VERCEL_GIT_COMMIT_SHA` or `dev` | Written to `Crawl_Log` |

## Google Sheets

1. Create a Google Cloud project and enable the Google Sheets API.
2. Create a service account and a JSON key if your deployment uses key JSON.
3. Create a spreadsheet with tabs named exactly:
   - `Products_Current`
   - `Price_History`
   - `Crawl_Log`
4. Share the spreadsheet with the service account email as **Editor**.
5. Store the JSON (or base64-encoded JSON) in `GOOGLE_SERVICE_ACCOUNT_JSON`.
6. Do not reorder columns after the first successful run without updating the code first.

The crawler writes headers if a tab is empty. If headers exist but do not match the expected order, the run fails instead of corrupting data.

## Local run

```bash
bun run typecheck
bun test
```

Use Vercel Dev with local bypass:

```bash
# .env
ALLOW_LOCAL_CRON=true
vercel dev
curl http://localhost:3000/api/cron/sm-crawler
```

Production-like local call:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/sm-crawler
```

Unauthorized production requests return `401` and do not fetch GraphQL or write Sheets.

## Deployment

1. Import the repo into Vercel.
2. Set all production environment variables. Use a separate spreadsheet for preview.
3. Set `CRON_SECRET` to a long random value. Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when that env var is present.
4. Confirm `vercel.json` schedule (`0 20 * * *` UTC by default). Change the cron expression there as needed.
5. Deploy, then invoke `GET /api/cron/sm-crawler` with the bearer secret.
6. Confirm Vercel logs and a `Crawl_Log` row.

Function timeout is 60 seconds. Stay on one category and sequential pagination for v1.

## Behavior

- GraphQL uses variables (`categoryId`, `pageSize`, `currentPage`). No string-concatenated queries.
- Pagination is sequential. `MAX_PAGES_PER_RUN` stops runaway crawls.
- Products without `id`/`uid`/`sku` are skipped. Duplicates are dropped by stable key.
- Successful full crawls replace `Products_Current` rows for the configured source/category/store context using batched Sheets writes (`RAW`).
- Failed, partial, blocked, or implausibly small crawls **do not** overwrite `Products_Current` and **do not** append removals.
- History rows are appended only for `new` / tracked-field `changed` / `removed` events after a successful full snapshot.
- Every crawl attempt appends one `Crawl_Log` row (success, partial, or failed).

Tracked change fields: `product_name`, `uom`, `price_php`, `regular_price_php`, `special_price`, `discount_percent`, `max_qty`, `product_url`.

## Smoke test

1. Create the spreadsheet and three tabs; share with the service account.
2. Configure `.env` and run locally with `ALLOW_LOCAL_CRON=true`.
3. Confirm `Products_Current` headers and rows.
4. Run again with unchanged data; `Price_History` should not gain a change event for those products (new products only appear on the first run).
5. Change a fixture/source price and confirm a `changed` history row with old/new prices.
6. Deploy and run the cron with `Authorization: Bearer $CRON_SECRET`.
7. Inspect Vercel logs and `Crawl_Log`.

## Troubleshooting

| Symptom | What to do |
|---|---|
| `401` from `/api/cron/sm-crawler` | Missing/incorrect `Authorization: Bearer $CRON_SECRET`. `ALLOW_LOCAL_CRON` is ignored when `VERCEL_ENV` or `NODE_ENV` is `production`. |
| `CONFIG_INVALID` | Check required env vars. The error lists field names, not secret values. |
| `SOURCE_BLOCKED` / `401`/`403` from GraphQL | Stop. Do not retry aggressively. Review terms and access; the source may be blocking automated traffic. |
| `SOURCE_GRAPHQL_ERROR` / validation errors | Schema or query drift. Inspect a truncated `error_message` in `Crawl_Log` and update `src/graphql`. |
| `PAGINATION_INCONSISTENT` or `MAX_PAGES_EXCEEDED` | Partial run; snapshot is left untouched. Raise `MAX_PAGES_PER_RUN` only if duration allows. |
| `SNAPSHOT_IMPLAUSIBLE` | Count dropped below `MIN_SNAPSHOT_RATIO`. Snapshot preserved for manual review. |
| `SHEETS_AUTH_ERROR` | Service account JSON invalid, or the spreadsheet is not shared as Editor. |
| `SHEETS_HEADER_MISMATCH` | Restore the PRD column order or update `src/sheets/columns.ts` first. |
| Quota / `429` from Sheets | Bounded exponential backoff is already applied. Reduce page size/history growth if it persists. |
| Function timeout | Narrow the category or lower `MAX_PAGES_PER_RUN`. Consider Cloud Run Jobs if the catalog grows. |

Secrets, service-account JSON, and authorization headers are never written to logs or HTTP responses.

## Tests

```bash
bun test
bun run typecheck
```

Unit coverage includes config defaults, GraphQL validation/pagination, product key/price/URL fallbacks, content hashing, snapshot diffing, plausibility, Sheets column order, retry policy, and cron authorization.
