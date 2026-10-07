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

- [x] `1.1` Confirm in the OpenNext Cloudflare docs that Next 15.5.9 and the Pages Router are supported
- [x] `1.2` Add `@opennextjs/cloudflare` and `wrangler` to `apps/web`
- [x] `1.3` Create `wrangler.jsonc` with `nodejs_compat`, a current compatibility date and the assets binding
- [x] `1.4` Create `open-next.config.ts`; add `preview`, `deploy` and `cf-typegen` scripts
- [x] `1.5` Call `initOpenNextCloudflareForDev()` in `next.config.js` so `next dev` sees D1, R2 and other bindings
- [x] `1.6` Stop forcing `output: "standalone"`
- [x] `1.7` Build once and record the compressed bundle size

**Status notes (2026-10-08):**

- `1.1`: `@opennextjs/cloudflare` 1.20.9 requires `next >=15.5.27 <16`, so `next` was upgraded from 15.5.9 to 15.5.27, a patch release within 15.5.
  - **vinext:** Cloudflare's own Next.js skill now recommends vinext (Next.js rebuilt on Vite) for new projects. It wasn't chosen here. Its README says it is "not yet a drop-in replacement for every application or production workload". It doesn't support webpack or Turbopack config, which this repo uses for SVG imports. It doesn't document support for SWC plugins, which Lingui needs here. Revisit after it matures.
- `1.3`: the Worker is named `kan-flare`, with `nodejs_compat` and `global_fetch_strictly_public` and compatibility date `2026-10-01`. Later phases add their own bindings.
- `1.2`: `@opennextjs/cloudflare` 1.20.9 and `wrangler` 4.148.0.
- `1.4`: `open-next.config.ts` has no incremental cache, because the app has no ISR pages. The new scripts are `preview`, `deploy`, `upload` and `cf-typegen`. `cf-typegen` writes `cloudflare-env.d.ts`; commit it, and rerun it whenever `wrangler.jsonc` changes.
- `1.7`: the Worker is **6.75 MiB gzipped** (28 MiB raw), measured with `wrangler deploy --dry-run`. That fits the paid plan's 10 MiB limit but not the free plan's 3 MiB. Static assets (9.8 MB) are served separately and don't count. Phases 3, 6 and 8 remove `pg`, the AWS SDK and pino from the bundle.
  - **Smoke test** with `wrangler dev`: `/` redirects to `/login`, and `/login`, `/signup`, static assets and `/api/v1/openapi.json` all return 200. `/api/auth/get-session` and tRPC respond, with tRPC correctly returning UNAUTHORIZED. The remaining errors come from the PGlite fallback needing a filesystem, which Phases 2–3 replace with D1.
  - **Tracing fix:** Next's file tracing only copies each package's Node.js files. Four packages also ship Workers-only builds: `pg-cloudflare`, `uncrypto`, `@react-email/render` and `stripe`. They are force-included through `outputFileTracingIncludes` in `next.config.js`, with the route key `"/**"`. The key `"*"` doesn't match nested routes. If a new dependency fails at runtime with `No such module "x"`, add it to that list. Drop `pg-cloudflare` once `pg` is removed.
  - **Port 8787:** a `wrangler dev` from another project held this port. Stop it before `pnpm preview`.
- `1.6`: nothing forces standalone output for the Workers build. Only the Dockerfile sets `NEXT_PUBLIC_USE_STANDALONE_OUTPUT=true`, and OpenNext picks its own output mode.
- **Other changes:**
  - `public/_headers` caches `/_next/static` for a year.
  - `.dev.vars.example` lists the local Workers values.
  - `.gitignore` covers `.open-next/`, `.wrangler/` and `.dev.vars`.
  - `tsconfig.json` and ESLint skip the `.open-next` and `.wrangler` folders, because this tsconfig also typechecks JavaScript files.
- The root `package.json` no longer installs Linux binaries on Macs, which makes installs much faster. Upstream's multi-architecture Docker builds stop working; Phase 13 removes Docker.
- **Checks:**
  - All 229 unit tests pass.
  - `@kan/web` typecheck has 3 errors, all present on upstream (`bootstrap.cjs` ×2 and `views/board/index.tsx:902`). Upstream's 8 SVG-import errors go away once a build has generated `next-env.d.ts`. `public/` is now excluded from typechecking, because Cloudflare's types flag the generated `__ENV.js`.
  - **`@kan/web` lint crashes.** Upstream's `@next/eslint-plugin-next` 14.2.32 calls `context.getAncestors()`, which ESLint 9.34 removed. Nothing in Phase 1 changed those versions. Fixing it means upgrading the plugin to match Next 15, which is left for later.

**Files:** `apps/web/package.json`, `apps/web/next.config.js`, `apps/web/wrangler.jsonc` (new), `apps/web/open-next.config.ts` (new)

**Done when:** The login page renders in `opennextjs-cloudflare preview`, and the bundle size is known.

### Phase 2: SQLite schema and fresh migrations

**Goal:** The data model is declared for SQLite, and one migration creates it in D1.
**Estimate:** 2–3 days

- [x] `2.1` Create the D1 database (`wrangler d1 create`) and add the binding
- [x] `2.2` Rewrite 17 schema files from `pgTable` to `sqliteTable`
- [x] `2.3` 17 enums become `text({ enum: [...] })`, which keeps the TypeScript types
- [x] `2.4` 34 UUID columns become `text` with `$defaultFn(() => crypto.randomUUID())`
- [x] `2.5` 39 serial columns become `integer().primaryKey({ autoIncrement: true })`
- [x] `2.6` 77 timestamps become `integer({ mode: "timestamp_ms" })`, and SQL defaults become `$defaultFn(() => new Date())`
- [x] `2.7` Check that relations and `drizzle-zod` schemas still compile
- [x] `2.8` Switch `drizzle.config.ts` to `dialect: "sqlite"` with the `d1-http` driver
- [x] `2.9` Move the 36 Postgres migrations to `migrations-pg-legacy/`; generate one SQLite baseline
- [x] `2.10` Apply the baseline to local D1 and open it in Drizzle Studio

**Status notes (2026-10-08):**

- `2.1`: no remote database is created by hand, so the deploy stays one-click. The `DB` binding in `wrangler.jsonc` has no `database_id`. `wrangler deploy` provisions the database on first deploy and reuses it after that. Local development and the deploy dry run both work without an ID.
- `2.2`–`2.6`: done with a codemod (Postgres builders to SQLite builders), then reviewed.
  - Enums keep their exported value arrays. For example, `importSourceEnum` became `importSourceValues`, used through `text(col, { enum })`.
  - The `pgEnum` objects were not used outside `schema/`.
  - `.enableRLS()` was dropped; SQLite has no row-level security.
  - `user.id` now defaults to `crypto.randomUUID()` in JS. There's no SQL default.
  - Timestamps have no SQL default either. Raw-SQL inserts must set `createdAt` themselves.
- `2.7`: relations and the rest of the schema compile. The only `@kan/db` type errors left are the 17 `tx.execute` calls that Phase 3 replaces.
- `2.8`: `drizzle.config.ts` uses `dialect: "sqlite"` and the `d1-http` driver. Credentials come from `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_D1_DATABASE_ID` and `CLOUDFLARE_D1_TOKEN`, and are only needed for `studio`.
- `2.9`: `migrations-pg-legacy/` keeps the 36 old files for reference. `migrations/0000_InitialSqliteSchema.sql` creates all 31 tables. New migrations use `pnpm db:generate`.
- `2.10`: `pnpm db:migrate` applies migrations to local D1, and `pnpm --filter @kan/web db:migrate:remote` applies them remotely. The local tables were checked with `wrangler d1 execute` instead of Drizzle Studio, because Studio needs remote credentials.
- **Database client:** `createDrizzleClient()` now returns a lazy client. It finds the `DB` binding through `getCloudflareContext()` the first time it's used in each request. That lets `trpc-context.ts` and the auth route keep creating it at module scope. `createD1Client(binding)` wraps a binding directly, for tests.
- **Integration tests:** they run on real local D1 through Wrangler's `getPlatformProxy()`, with each test getting its own in-memory database. All 16 existing tests pass, at about 200 ms each. This covers task `4.4`.
- **Behaviour confirmed on local D1:**
  - `db.transaction()` throws, because D1 doesn't allow `BEGIN`.
  - `db.batch()` works.
  - A query with 101 bound parameters fails with "too many SQL variables"; 100 works.

**Files:** `packages/db/src/schema/`* (17 files), `packages/db/drizzle.config.ts`, `packages/db/migrations`

**Done when:** `wrangler d1 migrations apply --local` creates every table, and `pnpm typecheck` passes for `@kan/db`.

### Phase 3: Port the repositories

**Goal:** Every query runs on D1, and card and list order stays correct.
**Estimate:** 5–7 days

- [x] `3.1` Rewrite the 15 `db.transaction()` blocks as `db.batch()`, using the three patterns above (card, list, checklist and board repos)
- [x] `3.2` Replace `tx.execute(sql`…`)` with `db.run(sql`…`)` and check the 27 raw SQL snippets for quoting and Postgres-only syntax
- [x] `3.3` Use subqueries for values that used to be read first: new card numbers, a list's last index, a checklist's last item
- [x] `3.4` Add a renumber statement to the end of every move or delete batch
- [x] `3.5` Split bulk inserts and `inArray` lists into chunks under D1's parameter limit; add one shared `chunk()` helper
- [x] `3.6` Replace `similarity()` and `ILIKE` in `workspace.repo.ts` with `LIKE`; keep the exact-match-first ordering
- [x] `3.7` Check that `.returning()` and `onConflictDoUpdate` calls behave the same on SQLite
- [x] `3.8` Make `createDrizzleClient` take the D1 binding from the request context; remove `pg` and PGlite

**Status notes (2026-10-08):**

- **Shared helpers in `packages/db/src/utils/d1.ts`:**
  - `runBatch`: runs statements as one atomic D1 batch.
  - `splitByParameters`: splits multi-row inserts so each statement stays under 100 bound parameters, measured from Drizzle's own `toSQL()` output.
  - `renumberIndexes`: rewrites positions to 0…n-1 per parent, using a window function and `UPDATE … FROM`.
  - `nextIndex`: a `COALESCE(MAX("index"), -1) + 1` subquery.
  - `idList`: builds the parenthesised id list after `IN`.
- **Drizzle bug worked around in `runBatch`:** in drizzle-orm 0.42, raw `db.run(sql…)` queries never get a prepared statement. Batching one with parameters fails with `Cannot read properties of undefined (reading 'bind')`. `runBatch` attaches the statement first.
- **`3.1` / `3.3` / `3.4`: all 15 transactions are gone.**
  - **Card create:** one batch that makes room, bumps `workspace.cardCounter`, inserts with `cardNumber` read by subquery inside the batch, logs the activity by `publicId` subquery, then renumbers the list.
  - **Bulk card create:** card numbers are the counter plus *n*, read inside the batch, and the counter is bumped after the inserts.
  - **Card and list reorder:** the earlier reads stay, then one batch does the moves, the renumber and the final read.
  - **Soft deletes:** a single batch of the update plus a renumber, with the parent found by subquery.
  - **Checklist and list create:** a single insert, with the index from a subquery.
  - **Board snapshot copy:** one batch. Labels, lists, cards, checklists, items and activities refer to their parents by `publicId` subqueries.
  - **Board move:** a single batch, with the card-member cleanup done by nested subqueries.
- **Small behaviour changes:**
  - List reorder now ignores deleted lists when shifting positions. Upstream also shifted deleted lists.
  - Card reorder's "last card in target list" read now ignores deleted cards.
- **`3.2`:** no `tx.execute` is left. Raw SQL quotes `"index"` everywhere, because `index` is a keyword.
- **`3.5`:** every bulk insert is split by parameter count: cards, lists, checklists, items, labels, activities, card-label and card-member links. Three id lists that could grow large now use subqueries instead of `IN (…)` lists: the board view's label and member filter, valid comments in the activity feed, and the member-permission reset.
  - **Behaviour change:** a board filter that matches no cards now shows no cards. Upstream showed every card in that case.
- **`3.6`:** search matches when every word of the query (up to 8) appears in the text, using `LIKE … ESCAPE`, so `%` and `_` are literal. Results rank exact match, then prefix, then substring, then most recently updated. Ticket-id prefixes compare case-insensitively.
- **`3.7`:** every `onConflictDoUpdate` target has a matching unique index or primary key, and the integration-provider upsert is covered by a test.
- **`3.8`:** `pg`, `@types/pg` and PGlite are removed. `POSTGRES_URL` is gone from `env.ts`, `turbo.json` and `.env.example`; the Docker files go in Phase 13.
- **Tests on local D1:**
  - `integration-tests/ordering.integration.test.ts` has 12 tests covering cards, lists, checklist items, bulk inserts past the parameter limit, board copy and board move. Every test asserts indexes are exactly 0…n-1.
  - `integration-tests/search.integration.test.ts` has 5 tests.
  - With the existing tests, that's 33 integration tests, all passing.
- **Not yet tested:** a real Trello import of a large board. Its bulk paths (`bulkCreate` for lists, cards and labels, plus the link tables) are covered by the tests above. A full import still needs a Trello API key, so it moves to Phase 12 (`12.4`).
- **Known limit:** copying a very large template (thousands of rows) is a single batch. D1 limits how many queries one request may run, so a copy may need splitting into several batches if that limit is ever hit.

**Files:** `packages/db/src/repository/`* (20 files), `packages/db/src/client.ts`, `packages/db/package.json`

**Done when:** Create, move within a list, move between lists and delete all keep indexes at 0…n-1. A Trello import of a large board succeeds.

> **Risk:** This is the riskiest phase. Write the ordering tests from Phase 12 (task `12.1`) before rewriting the card and list repos, then port against them.



### Phase 4: Auth, context and tests on D1

**Goal:** Better Auth and tRPC use the request's D1 client, and integration tests run without Postgres.
**Estimate:** 1–1.5 days

- [x] `4.1` Switch Better Auth's `drizzleAdapter` from `provider: "pg"` to `"sqlite"` and regenerate its tables
- [x] `4.2` Build the auth instance per request (or lazily) so it gets the D1 binding
- [x] `4.3` Pass the D1 client through the tRPC context
- [x] `4.4` Replace PGlite in `packages/api/integration-tests/test-db.ts` with an in-memory SQLite database that applies the same migrations

**Status notes (2026-10-08):**

- `4.1`: the Better Auth Drizzle adapter uses `provider: "sqlite"`. Its tables (`user`, `session`, `account`, `verification`, `apiKey`) are already in the SQLite baseline. ID generation stays with the database (`generateId: false`): integer auto-increment for sessions and accounts, and `crypto.randomUUID()` for users.
- `4.2` / `4.3`: no code change needed. `createDrizzleClient()` returns a lazy client that looks up the D1 binding per request, so the auth instance and tRPC context created at module scope keep working.
- `4.4`: the integration tests use local D1 through `getPlatformProxy()`, not plain in-memory SQLite. That's closer to production, because batch semantics and the parameter limit match.
- **End-to-end check:** `cloudflare-migration/smoke.mjs` runs against `wrangler dev`.
  - **What it does:** signs up with email and password, then creates a workspace, a board with lists and labels, and cards at the end and the start. It moves a card between lists, then searches.
  - **What it checks:** the final positions are exactly `Todo: zero@0, one@1, three@2 | Done: two@0`.
  - **Result:** it passes with no errors in the Worker log.
  - **To run it:**
    1. `pnpm db:migrate`
    2. An OpenNext build
    3. `wrangler dev`, with `NEXT_PUBLIC_ALLOW_CREDENTIALS=true` in `.dev.vars`
    4. `node cloudflare-migration/smoke.mjs`
- **Generated types:** `cf-typegen` now rewrites the generated `cloudflare-env.d.ts` so it no longer imports `./.open-next/worker`. Otherwise `tsc` typechecks OpenNext's generated JavaScript whenever a build exists.

**Files:** `packages/auth/src/auth.ts`, `packages/api/src/trpc.ts`, `packages/api/integration-tests/test-db.ts`

**Done when:** Sign-up, login and magic link work in the preview, and `pnpm test` passes.

### Phase 5: Deploy workflow

**Goal:** One GitHub Actions workflow migrates D1 and deploys the Worker.
**Estimate:** 0.5–1 day

- [ ] `5.1` Add `.github/workflows/deploy.yml`: install, test, `wrangler d1 migrations apply --remote`, build, `wrangler deploy`
- [ ] `5.2` Store `CLOUDFLARE_API_TOKEN` and the account ID as repository secrets
- [ ] `5.3` Push server secrets with `wrangler secret put`
- [x] `5.4` Add a staging environment with its own D1 database
- [x] `5.5` Turn on D1 Time Travel for point-in-time restore, and write down the restore command

**Status notes (2026-10-08):**

- **Deferred:** `5.1` and `5.2` (the GitHub Actions deploy workflow and repository secrets) are put off for a few weeks at the owner's request. Deploys run from a machine for now.
- **One-command deploy:** `pnpm --filter @kan/web deploy` builds, then runs `deploy:built`, which does three things:
  1. Migrates D1 if the database already exists. On the first deploy it doesn't, so this step prints a note and carries on.
  2. Runs `opennextjs-cloudflare deploy`. On the first run, this provisions the D1 database, because the binding has no `database_id`.
  3. Migrates again. This is a no-op when nothing is pending.

  `deploy:staging` does the same against `--env staging`. `CI=true` skips Wrangler's confirmation prompt.
- `5.3`: not done yet, because it writes to the Cloudflare account. Before the first deploy, run `wrangler secret put BETTER_AUTH_SECRET` from `apps/web`, adding `--env staging` for staging. Do the same for any OAuth client secrets in use. Non-secret values go in `vars` in `wrangler.jsonc`.
- `5.4`: `env.staging` in `wrangler.jsonc` has its own Worker (`kan-flare-staging`), its own self-reference and its own D1 database (`kan-flare-staging`), all provisioned on its first deploy. Wrangler environments don't inherit bindings, so every binding added later must also be added under `env.staging`. A dry run with `--env staging` resolves all bindings.
- `5.5`: D1 Time Travel is always on, with no setting to enable. It keeps 30 days of history on the paid plan and 7 on the free plan.
  - **To restore:** `wrangler d1 time-travel restore kan-flare --timestamp=<RFC3339 or unix>`. Add `--env staging` for staging.
  - **To find a bookmark first:** `wrangler d1 time-travel info kan-flare --timestamp=<…>`.
- **Logs:** `observability.logs.enabled` is on, so Worker logs show in the dashboard. Phase 8 makes them structured.
- **Bundle size:** with `pg` and PGlite gone, the Worker is **3.7 MiB gzipped** (19 MiB raw), down from 6.75 MiB.
- **Lint:** I linted only the files I changed in Phases 2–4, and they're clean apart from three things that aren't mine:
  - The parse errors on `integration-tests/*.ts`. Upstream's `packages/api` tsconfig doesn't include that folder, so its own test files show the same error.
  - Two non-null assertions in upstream's `parseTicketId`.
  - The new `@kan/db` client avoids the `AnyD1Database` type at runtime, because ESLint can't resolve it without Cloudflare's runtime types.

**Files:** `.github/workflows/deploy.yml` (new), `apps/web/wrangler.jsonc`

**Done when:** A push to `main` deploys to staging with no manual steps; a tag deploys to production.

### Phase 6: Storage on R2 bindings

**Goal:** Avatars and attachments live in R2, and the AWS SDK is gone.
**Estimate:** 2–3 days

- [x] `6.1` Create avatar and attachment buckets and add R2 bindings
- [x] `6.2` Replace `packages/shared/src/utils/s3.ts` with a storage module of the same shape
- [x] `6.3` Stream uploads into `bucket.put()` in `pages/api/upload/attachment.ts` and `avatar.ts`
- [x] `6.4` Replace presigned download URLs with an authorised route that streams from `bucket.get()` and keeps the membership check
- [x] `6.5` Update the routers that build URLs (attachment, card, board, user, workspace), the health check and `packages/auth/src/hooks.ts`
- [x] `6.6` Remove `@aws-sdk/*` and the `S3_*` variables

**Status notes (2026-10-08):**

- `6.1`: there are two R2 bindings, `AVATARS` and `ATTACHMENTS`. Production uses the buckets `kan-flare-avatars` and `kan-flare-attachments`; staging uses `kan-flare-staging-*`. Wrangler creates them on first deploy, so nothing is created by hand.
- `6.2`: `packages/shared/src/utils/s3.ts` is replaced by `storage.ts`, exported as the server-only subpath `@kan/shared/storage`. It isn't part of `@kan/shared/utils`, so the browser bundle can't pull it in.
  - **Functions:** `getBucket`, `isStorageConfigured`, `putObject`, `getObject`, `deleteObject`, `signFileUrl`, `verifyFileSignature`, `generateUploadUrl`, `generateAvatarUrl` and `generateAttachmentUrl`.
  - **Streamed uploads:** `putObject` streams through the Workers runtime's `FixedLengthStream`, because R2 needs a streamed body's length up front. Under `next dev` on Node, where that class doesn't exist, it buffers instead.
- `6.3`: `/api/upload/attachment` and `/api/upload/avatar` stream the request body into R2 with `Readable.toWeb(req)`.
- `6.4`: a new route, `/api/files/[...path]`, replaces S3 URLs:
  - **Avatars** (`/api/files/avatars/<key>`) are public, like the old public-read bucket, and cached for a day.
  - **Attachments** need a URL signed with HMAC-SHA256 (`exp`, `sig`), keyed off `BETTER_AUTH_SECRET`. That replaces S3 presigned URLs and keeps the same capability-URL model. Links last 24 hours, as before.
  - **Signed `PUT`** (`method=PUT`) backs `attachment.generateUploadUrl` for API clients, followed by `attachment.confirm`.
  - **Security:** files are now served from the app's own origin, so every response carries `Content-Security-Policy: sandbox` and `X-Content-Type-Options: nosniff`. Anything other than images, video, audio and PDF is forced to download.
- `/api/download/attatchment` now just redirects to the file route with `download=<filename>`.
  - **Workers quirk:** the encoded `&` inside its `url` parameter arrives decoded, so the signed URL's `exp`/`sig` show up as top-level parameters. The route copies them back.
- **Browser avatars:** `getAvatarUrl` in `apps/web/src/utils/helpers.ts` maps a key to `/api/files/avatars/<key>`.
- **Social login:** the `user.create.after` hook copies the provider's avatar into R2 whenever the image is an external URL and the avatars binding exists.
- **Health check:** `/health` checks storage with a `head()` on each bucket.
- `6.5`: done. The tests mock `@kan/shared/storage`.
- `6.6`: `@aws-sdk/*` is removed from `apps/web` and `@kan/shared`. These environment variables are gone:
  - `S3_*`
  - `NEXT_PUBLIC_{AVATAR,ATTACHMENTS}_BUCKET_NAME`
  - `NEXT_PUBLIC_STORAGE_{URL,DOMAIN}`
  - `NEXT_PUBLIC_USE_VIRTUAL_HOSTED_URLS`

  `S3_AVATAR_UPLOAD_LIMIT` is renamed `AVATAR_UPLOAD_LIMIT`. `packages/e2e` still uses the AWS SDK in its own helpers; Phase 12 will handle that.
- **Bundle size:** the Worker is now **2.87 MiB gzipped**, which fits even the free plan's 3 MiB limit.
- **Tests:**
  - `storage.test.ts` has 6 tests covering signing: wrong key, wrong method, tampered expiry, expired link, rotated secret.
  - `smoke.mjs` now checks storage end to end in `wrangler dev` against local R2: avatar upload and public fetch, attachment upload, a signed GET without a session, unsigned and tampered links rejected (403), PDF served inline under the sandbox policy, forced download, signed PUT upload plus confirm, delete removing the file (404), and the health check. All pass.
- **No migration script:** task 6.6 mentioned a one-off copy script for existing S3 files. It isn't needed, because kan-flare starts with empty storage.

**Files:** `packages/shared/src/utils/s3.ts`, `apps/web/src/pages/api/upload/`*, `apps/web/src/pages/api/download/attatchment.ts`, `packages/api/src/routers/`*, `packages/auth/src/hooks.ts`

**Done when:** Upload, view and delete work for avatars and attachments, and `@aws-sdk` is gone from the web app's dependencies.

### Phase 7: Email through Cloudflare

**Goal:** All four emails send through Cloudflare Email Service.
**Estimate:** 1 day

- [x] `7.1` Check the current Email Service binding API and limits; onboard the sending domain
- [x] `7.2` Rewrite `packages/email/src/sendEmail.tsx`: render the React Email template, send through the binding
- [x] `7.3` Keep the four templates and their callers unchanged
- [x] `7.4` Remove `nodemailer` and the `SMTP_*` variables; update test mocks

**Status notes (2026-10-08):**

- `7.1`: the binding API was checked against the Email Service docs (`send_email` binding, `env.EMAIL.send({ from, to, subject, html, text })`, errors with `.code`).
  - **Before first deploy** (needs the Cloudflare account): onboard the sending domain with `npx wrangler email sending enable <domain>`, and set `EMAIL_FROM` to an address on that domain.
  - **Local runs:** `wrangler dev` doesn't send mail. It writes each message to `apps/web/.wrangler/tmp/email/`.
- `7.2`: `packages/email/src/sendEmail.tsx` sends through the `EMAIL` binding.
  - **Sender:** `EMAIL_FROM` is still a single variable, and the `Name <address>` form is parsed into the binding's `{ email, name }`.
  - **Plain text:** a text version is sent alongside the HTML, which helps deliverability.
  - **Rendering:** templates render with `react-dom/server`'s `renderToStaticMarkup`, with the same XHTML doctype react-email adds, and `toPlainText` from `@react-email/render`. Under the `workerd` condition, `@react-email/render`'s own `render()` loads its edge build. That build needs `renderToReadableStream`, which the bundled React 18 server build lacks, so it fails with `reactDOMServer.renderToReadableStream is not a function`.
- `7.3`: the four templates and their callers are unchanged, apart from four `kan.bn` brand strings Phase 0 missed.
- `7.4`: `nodemailer`, `@types/nodemailer` and the `SMTP_*` variables are gone. The test mocks of `sendEmail` needed no change. `packages/e2e` still has Mailpit SMTP settings for its own harness; Phase 12 will handle those.
- **Checked:** in `wrangler dev`, signing up and then requesting a password reset sends `Reset Password` through the binding. The parsed sender is `"kan-flare" <noreply@example.com>`, and both HTML and text are rendered with the correct reset link.
- **Build failure seen once:** an OpenNext build failed with `SQLITE_BUSY` while a just-stopped `wrangler dev` was still releasing local D1. `next build` starts the local runtime through `initOpenNextCloudflareForDev()`. Retrying fixed it.

**Files:** `packages/email/src/sendEmail.tsx`, `packages/api/src/utils/notifications.test.ts`

**Done when:** A magic link and a mention email arrive in a real inbox.

### Phase 8: Lightweight logger

**Goal:** Logging needs no Node streams, and the 23 files that log stay the same.
**Estimate:** 0.5 days

- [x] `8.1` Rewrite `packages/logger/src/index.ts` as a console logger that prints JSON lines, honours `LOG_LEVEL` and keeps `createLogger(name)`
- [x] `8.2` Remove `pino`, `pino-pretty` and `@axiomhq/js`; drop `serverExternalPackages`
- [x] `8.3` Turn on Workers Logs

**Status notes (2026-10-08):**

- `8.1`: `packages/logger/src/index.ts` is now a dependency-free logger built on `console`.
  - **Same API:** `createLogger(module)` and `logger.child()`, with pino's call signatures: `(msg)`, `(fields, msg)`, and `(error, msg)`, which logs the error under `err`.
  - **Errors** are serialized with type, message, stack and cause.
  - **Output in production:** each entry is one object passed to `console.<level>`, which Workers Logs indexes as structured fields (level, time, module, requestId, procedure, duration and so on).
  - **Output in development:** one readable line.
  - **Level:** `LOG_LEVEL` is read when logging, because Workers populate `process.env` per request.
- `8.2`: `pino`, `pino-pretty` and `@axiomhq/js` are removed, along with `serverExternalPackages: ["pino"]` and `AXIOM_TOKEN`/`AXIOM_DATASET`. Axiom shipping was only for Kan's hosted cloud.
- `8.3`: Workers Logs was turned on in Phase 5 (`observability.logs.enabled`).
- **Fix found here:** `initOpenNextCloudflareForDev()` now runs only outside production. `next build` loads `next.config.js` in several workers at once. Each started a local runtime on the same D1 state, and builds failed intermittently with `SQLITE_BUSY`. Two builds in a row now pass.
- **Bundle size:** **2.77 MiB gzipped**. The smoke test passes.

**Files:** `packages/logger/src/index.ts`, `apps/web/next.config.js`

**Done when:** Logs from a tRPC call appear in Workers Logs with level, module and message.

### Phase 9: Replace runtime env injection

**Goal:** Nothing is written at startup; public values come from the build.
**Estimate:** 1–2 days

- [x] `9.1` Replace `next-runtime-env` calls with `process.env.NEXT_PUBLIC_…` in about 50 files
- [x] `9.2` Read server values from Worker vars and secrets through one helper
- [x] `9.3` Remove `configureRuntimeEnv()`, the `__ENV.js` script tag and `bootstrap.cjs`
- [x] `9.4` Keep `env.ts` validation so a missing value fails the build

**Status notes (2026-10-08):**

- `9.1`: a codemod converted 44 files.
  - **Web app (31 files):** `env("X")` became `env.X` from `~/env`, the typed environment module, which the app's lint rule requires.
  - **API, auth and email packages (13 files):** it became `process.env.X`.
  - **`env.ts`:** `NEXT_PUBLIC_DISABLE_EMAIL` and `NEXT_PUBLIC_PARTNER_NAME` were missing and are now declared.
  - **Tests:** the four that mocked `next-runtime-env` now mock `~/env` through a proxy, or set `process.env`.
- `9.2`: no helper was needed. With `nodejs_compat`, Workers put Worker vars and secrets on `process.env`, so server code reads `process.env.X` at request time.
- `9.3`: `configureRuntimeEnv()`, the `/__ENV.js` script tag and `bootstrap.cjs` are removed, along with `next-runtime-env` from `apps/web` and `@kan/shared`. `next.config.js` reads `process.env` directly. `apps/web/Dockerfile` still references `bootstrap.cjs`; Docker goes in Phase 13.
- `9.4`: `env.ts` validation still runs at build.
- **Where values come from now:**
  - **`NEXT_PUBLIC_*`** values are compiled into both the browser and server bundles at build time. Set them in the build's environment; `pnpm build` loads the repo-root `.env` through `with-env`. Staging and production need separate builds with their own values, because the deploy scripts build once per environment.
  - **Server-only values** (`BETTER_AUTH_SECRET`, OAuth secrets, `EMAIL_FROM`, `LOG_LEVEL` and so on) are read at runtime. Set them with `wrangler secret put`, or as `vars` in `wrangler.jsonc`.
- **Checked:** `/` redirects to the built-in base URL, the browser bundle contains it, `/__ENV.js` no longer exists, and the full smoke test passes.
- **Also fixed:** the API request logger now redacts `sig` from logged query strings. A valid signed-file signature in the logs would grant access until it expired.
- **Typecheck:** `@kan/web` is down to 1 error, upstream's `views/board/index.tsx:902`, now that `bootstrap.cjs` is gone.

**Files:** `apps/web/next.config.js`, `apps/web/src/env.ts`, `apps/web/bootstrap.cjs`, about 50 files

**Done when:** A search for `next-runtime-env` finds nothing, and the middleware login redirect works in staging.

### Phase 10: Image loader with R2 variants

**Goal:** Images are converted once, stored in R2, then served from cache.
**Estimate:** 2 days

- [x] `10.1` Add an image route keyed by source, width, quality and format
- [x] `10.2` On a hit, stream from R2 with long cache headers; on a miss, transform with Cloudflare image transformations, store, return
- [x] `10.3` Add a custom `next/image` loader for the six components that use it
- [x] `10.4` Delete variants when the source file is deleted

**Status notes (2026-10-08):**

- `10.1`: `/api/image?s=<base64url source>&w=<width>&q=<quality>` is in `apps/web/src/pages/api/image.ts`.
  - **Allowed sources:** stored avatars; attachments, only when their signature is valid; static assets, fetched through the `ASSETS` binding; and external `https` images. Anything else gets 403.
  - **Limits:** widths up to 3840 and source images up to 20 MB.
  - The source is base64url-encoded because of the Workers query-decoding quirk found in Phase 6.
- `10.2`:
  - **Format:** AVIF or WebP when the browser's `Accept` header allows it, otherwise JPEG or PNG.
  - **Storage:** variants live in a new `IMAGE_VARIANTS` R2 bucket, keyed by source plus version (R2 etag), width, quality and format. A hit streams from R2; a miss converts once with the Images binding (`env.IMAGES`) and stores the result.
  - **Fallbacks:** SVG and GIF pass through untouched. If conversion fails or the binding is missing, the original is served.
  - **Response headers:** `X-Image-Cache: hit|miss|bypass`, `Vary: Accept`, the sandbox policy and `nosniff`. Avatars, static and external images are publicly cacheable for a day; attachments are private.
- `10.3`: `src/utils/image-loader.ts` is the custom `next/image` loader, set with `images.loader: "custom"` in `next.config.js`. The old `remotePatterns` and OIDC block are gone, because the route decides what's allowed. All six components keep using `next/image` unchanged.
- `10.4`: deleting an attachment, uploading an avatar, or copying a social-login avatar deletes that image's variants. Variants share a per-source prefix (`deleteImageVariants` in `@kan/shared/storage`).
- **Bindings:** `images` (`IMAGES`) and the `IMAGE_VARIANTS` bucket, for both production and staging. Nothing needs creating by hand.
- **Billing:** image transformations are billed per unique transformation each month, which storing variants keeps low. Locally, `wrangler dev` uses a simplified Images simulator (width, height, rotate and format only).
- **Checked:**
  - Unit tests round-trip the loader's encoding, including signed URLs and non-ASCII names.
  - The smoke test confirms an avatar is served as AVIF on the first request (`miss`) and from R2 on the second (`hit`). It also confirms unsigned attachment sources (403), plain-`http` sources (403) and bad parameters (400) are rejected.

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

- [x] `12.1` Write ordering tests first (before Phase 3): create at position, move within a list, move between lists, delete, bulk import
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