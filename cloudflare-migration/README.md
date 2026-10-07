# Moving Kan to Cloudflare Workers and D1

This is the working plan for **kan-flare** (`git@github.com:cybars69/kan-flare.git`), a fork of [kanbn/kan](https://github.com/kanbn/kan) at `d0809f05`. The goal is to run the whole app on Cloudflare, with nothing hosted elsewhere:

- **Workers** for the app
- **D1** for data
- **R2** for files
- **Email Service** for mail

**This file is the source of truth for progress.** Tick a task (`- [x]`) in the same commit that finishes it. A copy of the plan is published at [https://claude.ai/artifact/8vjYouY8mzSceHgsLBCyVD](https://claude.ai/artifact/8vjYouY8mzSceHgsLBCyVD). That page is updated from this file, never the other way round (see [Syncing the published plan](#syncing-the-published-plan)).

- **Plan written:** 2026-10-07
- **Estimate:** 14 phases, 73 tasks, about 20–29 working days for one developer who knows the codebase



## Progress log

Add a line when you finish a phase or make a decision that changes the plan. Newest first.


| Date       | Who | What                                                                         |
| ---------- | --- | ---------------------------------------------------------------------------- |
| 2026-10-08 | Claude (for Arsalan) | Phase 0 done except new icon artwork (`0.3`). Remotes repointed, `workers` branch created, renamed to kan-flare, `NOTICE` added, billing routes removed. Build, tests and a local run checked. |
| 2026-10-07 | —   | Plan finalised. D1 chosen over Hyperdrive so no external Postgres is needed. |




## Decisions


| Component                                             | Decision   | What happens                                                                                                                                                                 |
| ----------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Next.js 15.5.9 (Pages Router), tRPC, Better Auth, MCP | Keep       | Run on Workers through the OpenNext Cloudflare adapter.                                                                                                                      |
| Postgres (Drizzle + `pg`)                             | Change: D1 | Schema and repositories ported to SQLite. No external database. Hyperdrive was rejected because it still needs a Postgres host.                                              |
| PGlite fallback and test database                     | Change     | Local D1 through Wrangler for development; SQLite in memory for integration tests.                                                                                           |
| Migrations at container start                         | Change     | `wrangler d1 migrations apply` in the deploy workflow.                                                                                                                       |
| `ioredis` + `rate-limiter-flexible`                   | Change     | Workers Rate Limiting binding.                                                                                                                                               |
| AWS S3 SDK                                            | Change     | R2 bindings; AWS SDK removed for bundle size.                                                                                                                                |
| `nodemailer` / SMTP                                   | Change     | Cloudflare Email Service; React Email templates kept.                                                                                                                        |
| `pino`, `pino-pretty`, Axiom                          | Change     | A small console-based logger with the same `createLogger` API. Morgan was considered, but it's an HTTP request logger for Express servers and doesn't replace an app logger. |
| `next-runtime-env` + `bootstrap.cjs`                  | Change     | Public values set at build time; server values from Worker vars and secrets.                                                                                                 |
| `next/image`                                          | Change     | Custom loader on Cloudflare image transformations, with converted variants stored in R2.                                                                                     |
| Upstream sync                                         | Accepted   | No PRs to upstream, to avoid hurting Kan's hosted business. Upstream fixes outside `packages/db` still merge; schema and query changes are ported to SQLite by hand.         |




## Why there's no Postgres-to-D1 converter

D1 is SQLite, not MySQL. No tool reliably translates Postgres queries to SQLite while the app is running, and we don't need one. Drizzle ORM already does most of that job:

- **Queries:** about 5,800 lines of repository code use Drizzle's query builder. It writes SQLite automatically once the schema is declared with `sqliteTable`.
- **DDL:** don't translate the 36 Postgres migrations. After the schema files are rewritten, `drizzle-kit generate` writes one fresh SQLite migration.
- **Manual work:** 15 `db.transaction()` blocks, 27 raw `sql` snippets and the `pg_trgm` fuzzy search are Postgres-specific. Phase 3 rewrites them. `sqlglot` (Python) can draft translations of individual snippets for checking.



## D1 limits that shape the code

- **No interactive transactions.** You can't read, decide, then write inside one transaction. `db.batch()` runs a list of statements atomically, and that's how the 15 `db.transaction()` blocks get rewritten.
- **About 100 bound parameters per query.** Bulk inserts in Trello import and board duplication (`board.repo.ts:918–985`, `cardActivity.repo.ts`, the `bulkCreate` functions) and the 21 `inArray` calls must be split into chunks.
- **Size and per-request query caps.** The database size limit is around 10 GB, plenty for internal use. There's also a cap on queries per request. Check current numbers on the D1 limits page during Phase 2.
- **One writer at a time.** D1 runs writes one after another, so two batches never interleave. Only the gap between a read and the batch that follows it can race.



## How the transactions get rewritten

1. **Writes only.** Blocks that only write become one `db.batch([...])`, with the same guarantees as before.
2. **Read, then write.** Move the value into SQL so no read is needed. For example, a new card number comes from a subquery inside the same batch:
  ```sql
   INSERT INTO card (…, "number")
   VALUES (…, (SELECT "cardCounter" FROM workspace WHERE id = ?))
  ```
3. **Self-healing order.** End every move or delete batch by renumbering the affected list, so even a race can't leave gaps or duplicate positions:
  ```sql
   UPDATE card SET "index" = r.n - 1
   FROM (
     SELECT id, ROW_NUMBER() OVER (ORDER BY "index", id) AS n
     FROM card WHERE "listId" = ? AND "deletedAt" IS NULL
   ) r
   WHERE card.id = r.id
  ```



## Plan

Phases are in build order. Task numbers (`3.2` means Phase 3, task 2) stay fixed, so the published page can match them; don't renumber. To add a task, append it to the end of its phase with the next number.

### Phase 0: Fork setup

**Goal:** kan-flare is the working repo, with upstream kept as a remote for merges.
**Estimate:** 0.5 days

- [x] `0.1` Point `origin` at `git@github.com:cybars69/kan-flare.git` and add `kanbn/kan` as `upstream`
- [x] `0.2` Create a `workers` branch for the port
- [ ] `0.3` Rename the product and replace the logo and favicon in `apps/web/public`
- [x] `0.4` Add your copyright line beside upstream's; keep `LICENSE` as AGPL-3.0
- [x] `0.5` Delete the Stripe, partner and Kan-cloud-only routes you'll never use, to shrink the surface

**Status notes (2026-10-08):**

- `0.3` is half done.
  - **Done:** the name is now **kan-flare** wherever a self-hosted user sees it: sidebar and auth wordmarks, page titles, the PWA manifest, the four emails, the magic-link subject and the OpenAPI title.
  - **Still open:** `favicon.ico` and `icon-512.png` still show the Kan artwork and need a new icon from the owner.
  - **Left as Kan on purpose:**
    - The marketing, pricing, privacy, terms, upgrade and partner pages. Self-hosted mode redirects `/` to `/login`, so they never show.
    - The "Powered by kan.bn" badge on public boards. It credits upstream and can be hidden with `NEXT_PUBLIC_WHITE_LABEL_HIDE_POWERED_BY`.
  - **Translations:** only the four renamed messages were edited in each `messages.json`. Running `lingui:extract` rewrites about 55,000 lines in the catalogs, which would cause conflicts on every upstream merge, so avoid running it.
- `0.4`: upstream has no copyright line. A new `NOTICE` file credits "the Kan contributors" and "the kan-flare contributors". Change the second to a named holder if someone holds the copyright. The root `README.md` has a short note at the top about the fork.
- `0.5`: only `pages/api/stripe` and `pages/api/partner` were deleted, as agreed.
  - `@kan/stripe` and the Better Auth Stripe plugin stay; they do nothing without keys.
  - The UI that called these routes only appears when `NEXT_PUBLIC_KAN_ENV=cloud`.
  - `pages/partner/activate.tsx` and `packages/e2e/tests/support/cloud-billing.ts` still reference them but are also cloud-only.
- **Baseline checks.** These numbers are the same on unchanged upstream. Compare against them, don't try to fix them:
  - `@kan/web` typecheck: 11 errors.
  - Lint: 8 errors in `@kan/auth`, 117 errors and 7 warnings in `@kan/email`, 50 errors in `@kan/api`.
  - Unit tests: all 229 pass.
  - `@kan/docs` has no dependencies installed. Use `--filter='!@kan/docs'` with turbo.

**Files:** `README.md`, `apps/web/public`, `apps/web/src/pages/api/{stripe,partner}`

**Done when:** kan-flare builds and runs unchanged under the new name.

### Phase 1: Workers foundation

**Goal:** The app builds with OpenNext and boots in the local Workers runtime.
**Estimate:** 1–2 days

- [ ] `1.1` Confirm in the OpenNext Cloudflare docs that Next 15.5.9 and the Pages Router are supported
- [ ] `1.2` Add `@opennextjs/cloudflare` and `wrangler` to `apps/web`
- [ ] `1.3` Create `wrangler.jsonc` with `nodejs_compat`, a current compatibility date and the assets binding
- [ ] `1.4` Create `open-next.config.ts`; add `preview`, `deploy` and `cf-typegen` scripts
- [ ] `1.5` Call `initOpenNextCloudflareForDev()` in `next.config.js` so `next dev` sees D1, R2 and other bindings
- [ ] `1.6` Stop forcing `output: "standalone"`
- [ ] `1.7` Build once and record the compressed bundle size

**Files:** `apps/web/package.json`, `apps/web/next.config.js`, `apps/web/wrangler.jsonc` (new), `apps/web/open-next.config.ts` (new)

**Done when:** The login page renders in `opennextjs-cloudflare preview`, and the bundle size is known.

### Phase 2: SQLite schema and fresh migrations

**Goal:** The data model is declared for SQLite, and one migration creates it in D1.
**Estimate:** 2–3 days

- [ ] `2.1` Create the D1 database (`wrangler d1 create`) and add the binding
- [ ] `2.2` Rewrite 17 schema files from `pgTable` to `sqliteTable`
- [ ] `2.3` 17 enums become `text({ enum: [...] })`, which keeps the TypeScript types
- [ ] `2.4` 34 UUID columns become `text` with `$defaultFn(() => crypto.randomUUID())`
- [ ] `2.5` 39 serial columns become `integer().primaryKey({ autoIncrement: true })`
- [ ] `2.6` 77 timestamps become `integer({ mode: "timestamp_ms" })`, and SQL defaults become `$defaultFn(() => new Date())`
- [ ] `2.7` Check that relations and `drizzle-zod` schemas still compile
- [ ] `2.8` Switch `drizzle.config.ts` to `dialect: "sqlite"` with the `d1-http` driver
- [ ] `2.9` Move the 36 Postgres migrations to `migrations-pg-legacy/`; generate one SQLite baseline
- [ ] `2.10` Apply the baseline to local D1 and open it in Drizzle Studio

**Files:** `packages/db/src/schema/`* (17 files), `packages/db/drizzle.config.ts`, `packages/db/migrations`

**Done when:** `wrangler d1 migrations apply --local` creates every table, and `pnpm typecheck` passes for `@kan/db`.

### Phase 3: Port the repositories

**Goal:** Every query runs on D1, and card and list order stays correct.
**Estimate:** 5–7 days

- [ ] `3.1` Rewrite the 15 `db.transaction()` blocks as `db.batch()`, using the three patterns above (card, list, checklist and board repos)
- [ ] `3.2` Replace `tx.execute(sql`…`)` with `db.run(sql`…`)` and check the 27 raw SQL snippets for quoting and Postgres-only syntax
- [ ] `3.3` Use subqueries for values that used to be read first: new card numbers, a list's last index, a checklist's last item
- [ ] `3.4` Add a renumber statement to the end of every move or delete batch
- [ ] `3.5` Split bulk inserts and `inArray` lists into chunks under D1's parameter limit; add one shared `chunk()` helper
- [ ] `3.6` Replace `similarity()` and `ILIKE` in `workspace.repo.ts` with `LIKE`; keep the exact-match-first ordering
- [ ] `3.7` Check that `.returning()` and `onConflictDoUpdate` calls behave the same on SQLite
- [ ] `3.8` Make `createDrizzleClient` take the D1 binding from the request context; remove `pg` and PGlite

**Files:** `packages/db/src/repository/`* (20 files), `packages/db/src/client.ts`, `packages/db/package.json`

**Done when:** Create, move within a list, move between lists and delete all keep indexes at 0…n-1. A Trello import of a large board succeeds.

> **Risk:** This is the riskiest phase. Write the ordering tests from Phase 12 (task `12.1`) before rewriting the card and list repos, then port against them.



### Phase 4: Auth, context and tests on D1

**Goal:** Better Auth and tRPC use the request's D1 client, and integration tests run without Postgres.
**Estimate:** 1–1.5 days

- [ ] `4.1` Switch Better Auth's `drizzleAdapter` from `provider: "pg"` to `"sqlite"` and regenerate its tables
- [ ] `4.2` Build the auth instance per request (or lazily) so it gets the D1 binding
- [ ] `4.3` Pass the D1 client through the tRPC context
- [ ] `4.4` Replace PGlite in `packages/api/integration-tests/test-db.ts` with an in-memory SQLite database that applies the same migrations

**Files:** `packages/auth/src/auth.ts`, `packages/api/src/trpc.ts`, `packages/api/integration-tests/test-db.ts`

**Done when:** Sign-up, login and magic link work in the preview, and `pnpm test` passes.

### Phase 5: Deploy workflow

**Goal:** One GitHub Actions workflow migrates D1 and deploys the Worker.
**Estimate:** 0.5–1 day

- [ ] `5.1` Add `.github/workflows/deploy.yml`: install, test, `wrangler d1 migrations apply --remote`, build, `wrangler deploy`
- [ ] `5.2` Store `CLOUDFLARE_API_TOKEN` and the account ID as repository secrets
- [ ] `5.3` Push server secrets with `wrangler secret put`
- [ ] `5.4` Add a staging environment with its own D1 database
- [ ] `5.5` Turn on D1 Time Travel for point-in-time restore, and write down the restore command

**Files:** `.github/workflows/deploy.yml` (new), `apps/web/wrangler.jsonc`

**Done when:** A push to `main` deploys to staging with no manual steps; a tag deploys to production.

### Phase 6: Storage on R2 bindings

**Goal:** Avatars and attachments live in R2, and the AWS SDK is gone.
**Estimate:** 2–3 days

- [ ] `6.1` Create avatar and attachment buckets and add R2 bindings
- [ ] `6.2` Replace `packages/shared/src/utils/s3.ts` with a storage module of the same shape
- [ ] `6.3` Stream uploads into `bucket.put()` in `pages/api/upload/attachment.ts` and `avatar.ts`
- [ ] `6.4` Replace presigned download URLs with an authorised route that streams from `bucket.get()` and keeps the membership check
- [ ] `6.5` Update the routers that build URLs (attachment, card, board, user, workspace), the health check and `packages/auth/src/hooks.ts`
- [ ] `6.6` Remove `@aws-sdk/*` and the `S3_*` variables

**Files:** `packages/shared/src/utils/s3.ts`, `apps/web/src/pages/api/upload/`*, `apps/web/src/pages/api/download/attatchment.ts`, `packages/api/src/routers/`*, `packages/auth/src/hooks.ts`

**Done when:** Upload, view and delete work for avatars and attachments, and `@aws-sdk` is gone from the web app's dependencies.

### Phase 7: Email through Cloudflare

**Goal:** All four emails send through Cloudflare Email Service.
**Estimate:** 1 day

- [ ] `7.1` Check the current Email Service binding API and limits; onboard the sending domain
- [ ] `7.2` Rewrite `packages/email/src/sendEmail.tsx`: render the React Email template, send through the binding
- [ ] `7.3` Keep the four templates and their callers unchanged
- [ ] `7.4` Remove `nodemailer` and the `SMTP_*` variables; update test mocks

**Files:** `packages/email/src/sendEmail.tsx`, `packages/api/src/utils/notifications.test.ts`

**Done when:** A magic link and a mention email arrive in a real inbox.

### Phase 8: Lightweight logger

**Goal:** Logging needs no Node streams, and the 23 files that log stay the same.
**Estimate:** 0.5 days

- [ ] `8.1` Rewrite `packages/logger/src/index.ts` as a console logger that prints JSON lines, honours `LOG_LEVEL` and keeps `createLogger(name)`
- [ ] `8.2` Remove `pino`, `pino-pretty` and `@axiomhq/js`; drop `serverExternalPackages`
- [ ] `8.3` Turn on Workers Logs

**Files:** `packages/logger/src/index.ts`, `apps/web/next.config.js`

**Done when:** Logs from a tRPC call appear in Workers Logs with level, module and message.

### Phase 9: Replace runtime env injection

**Goal:** Nothing is written at startup; public values come from the build.
**Estimate:** 1–2 days

- [ ] `9.1` Replace `next-runtime-env` calls with `process.env.NEXT_PUBLIC_…` in about 50 files
- [ ] `9.2` Read server values from Worker vars and secrets through one helper
- [ ] `9.3` Remove `configureRuntimeEnv()`, the `__ENV.js` script tag and `bootstrap.cjs`
- [ ] `9.4` Keep `env.ts` validation so a missing value fails the build

**Files:** `apps/web/next.config.js`, `apps/web/src/env.ts`, `apps/web/bootstrap.cjs`, about 50 files

**Done when:** A search for `next-runtime-env` finds nothing, and the middleware login redirect works in staging.

### Phase 10: Image loader with R2 variants

**Goal:** Images are converted once, stored in R2, then served from cache.
**Estimate:** 2 days

- [ ] `10.1` Add an image route keyed by source, width, quality and format
- [ ] `10.2` On a hit, stream from R2 with long cache headers; on a miss, transform with Cloudflare image transformations, store, return
- [ ] `10.3` Add a custom `next/image` loader for the six components that use it
- [ ] `10.4` Delete variants when the source file is deleted

**Files:** `apps/web/src/pages/api/image` (new), `apps/web/src/utils/image-loader.ts` (new), `apps/web/next.config.js`

**Done when:** A large avatar is served as a small AVIF or WebP, and the second request reads it from R2.

> **Risk:** Image transformations must be enabled on the zone and are billed per unique transform.



### Phase 11: Rate limiting binding

**Goal:** Rate limits hold across Worker instances with no Redis.
**Estimate:** 0.5–1 day

- [ ] `11.1` Add Rate Limiting bindings for the limits in `rateLimit.ts`
- [ ] `11.2` Rewrite `packages/api/src/utils/rateLimit.ts` on the binding; keep its API for the ten callers
- [ ] `11.3` Remove `ioredis`, `rate-limiter-flexible`, `packages/db/src/redis.ts` and `REDIS_URL`

**Files:** `packages/api/src/utils/rateLimit.ts`, `packages/db/src/redis.ts`

**Done when:** Repeated login attempts get a 429.

### Phase 12: Test and harden

**Goal:** The Workers build behaves like the Docker build, especially card order.
**Estimate:** 3–4 days

- [ ] `12.1` Write ordering tests first (before Phase 3): create at position, move within a list, move between lists, delete, bulk import
- [ ] `12.2` Add a check that every list's indexes are exactly 0…n-1 after each test
- [ ] `12.3` Run the Playwright suite in self-hosted mode against the preview
- [ ] `12.4` Test uploads, image variants, every email and each login method you use
- [ ] `12.5` Run `pnpm lint`, `pnpm typecheck` and `pnpm test`
- [ ] `12.6` Record the final bundle size and cold-start time

**Files:** `packages/api/integration-tests`, `packages/e2e`

**Done when:** The e2e suite passes against staging, and staging runs for a few days with no new errors.

### Phase 13: Docs and release

**Goal:** Someone else can deploy kan-flare from the README.
**Estimate:** 0.5 days

- [ ] `13.1` Write a deploy guide: D1, R2, Email Service, image transformations, rate limits, secrets
- [ ] `13.2` Update `.env.example`, `turbo.json` and the README variable table, as `AGENTS.md` requires
- [ ] `13.3` Remove the Docker files and `docker-publish` workflow
- [ ] `13.4` Tag the first release

**Files:** `README.md`, `.env.example`, `turbo.json`, `docker-compose.yml`, `apps/web/Dockerfile`

**Done when:** A clean Cloudflare account can deploy kan-flare by following the README.

## Risks to watch

- **Card and list order.** Phase 3 is the riskiest. The renumbering step and the ordering tests in Phase 12 are both there to catch mistakes.
- **Bundle size.** Workers allow about 10 MB compressed on paid plans. Removing the AWS SDK, pino and `pg` should leave plenty of room. Phase 1 measures the starting size.
- **Plan tier.** The Workers Paid plan has much higher D1 and CPU limits than the free plan. Budget for it.
- **Newer Cloudflare APIs.** Check OpenNext support for Next 15.5.9 and the Email Service binding API against current docs in Phases 1 and 7.
- **Search quality.** SQLite has no fuzzy matching like `pg_trgm`. Phase 3 starts with `LIKE`; switch to SQLite's full-text search (FTS5) if results feel worse.
- **Upstream drift.** Keep Cloudflare code behind small adapters (storage, mail, logger, rate limit, db client) so upstream merges conflict in a few files.



## Licensing

- kan-flare stays AGPL-3.0 with its source public. Not sending PRs upstream is allowed.
- Use a name other than Kan in the product and replace the logo; the license grants no rights to their branding.
- Keep upstream's copyright notices and add your own for new files.



## Syncing the published plan

The published page keeps its ticks in the viewer's browser, so this file is what records real progress. To bring the page up to date:

1. Make sure this file's checkboxes match what's been merged.
2. Ask Claude to "sync the Workers plan artifact from `cloudflare-migration/README.md`".
3. Claude reads the ticked task numbers here and republishes the page with them shown as done.

Edits to tasks themselves (new tasks, changed estimates) go here first, then into the page in the same sync.