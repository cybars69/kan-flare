# Deploying kan-flare to Cloudflare

kan-flare runs entirely on Cloudflare:

| Piece | Cloudflare product | Binding in `apps/web/wrangler.jsonc` |
| --- | --- | --- |
| Web app and API (Next.js via OpenNext) | Workers | – |
| Database | D1 | `DB` |
| Avatars and attachments | R2 | `AVATARS`, `ATTACHMENTS` |
| Resized images | Images + R2 | `IMAGES`, `IMAGE_VARIANTS` |
| Email | Email Service | `EMAIL` |
| Rate limiting | Workers Rate Limiting | `RATE_LIMIT_100/300/600` |

None of these need creating by hand. Bindings without IDs are provisioned by `wrangler deploy` the first time, and reused afterwards.

## Before the first deploy

1. **Account and tools.** Use a Cloudflare account on the Workers Paid plan. The free plan's limits on CPU time, D1 queries per request and bundle size (3 MiB, where kan-flare is about 2.8 MiB) leave little headroom. You also need Node.js 20+ and pnpm 9.

   ```sh
   pnpm install
   cd apps/web && npx wrangler login
   ```

2. **Email domain.** Mail is sent from a domain onboarded to Cloudflare Email Service:

   ```sh
   npx wrangler email sending enable mail.example.com
   ```

3. **Images.** Cloudflare Images transformations must be available on the account. They're billed per unique transformation each month. kan-flare stores every variant in R2, so each one is made only once.

4. **Build-time settings.** `NEXT_PUBLIC_*` values are compiled into the build, so they have to be in the environment of the machine that runs the deploy. Put them in `.env` at the repository root (see `.env.example`):

   ```sh
   NEXT_PUBLIC_BASE_URL=https://kan.example.com
   NEXT_PUBLIC_ALLOW_CREDENTIALS=true   # email + password sign-in
   NEXT_PUBLIC_DISABLE_SIGN_UP=false
   BETTER_AUTH_SECRET=...               # also needed at build for env validation
   ```

5. **Runtime secrets and settings.** These are read by the Worker at request time. Set secrets once, from `apps/web`:

   ```sh
   npx wrangler secret put BETTER_AUTH_SECRET
   npx wrangler secret put EMAIL_FROM           # e.g. "kan-flare <hello@mail.example.com>"
   # plus any OAuth/OIDC client secrets you use, e.g.
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   ```

   Non-secret settings (`EMAIL_FROM`, `LOG_LEVEL`, OAuth client IDs…) can go in `vars` in `wrangler.jsonc` instead. The README's environment variable table lists them all.

## Closed sign-up and email

For a private instance:

```sh
# .env (build-time)
NEXT_PUBLIC_DISABLE_SIGN_UP=true    # only the first account and email invitees can sign up
# runtime (wrangler.jsonc vars or a secret)
DISABLE_NOTIFICATION_EMAILS=true    # no mention emails
```

- **The first person to sign up** on a fresh install gets an account even with sign-up disabled. They create the first workspace and are its admin. After that, sign-up is closed.
- **Adding people:** invite them by email from the workspace's Members page. An invitee can sign up because of the pending invitation. Invite links don't work while sign-up is closed, because the link's recipient has no invitation to match.
- **`DISABLE_NOTIFICATION_EMAILS`** stops mention emails only. Magic-link sign-in, invite and password-reset emails still go out, and mentions still appear as in-app notifications.
- **Leave `NEXT_PUBLIC_DISABLE_EMAIL` unset:** it hides magic-link sign-in and email invites.

## Deploy

```sh
pnpm --filter @kan/web deploy
```

This builds the Worker and then deploys it, migrating D1 along the way. On the first deploy, the migration before deploy finds no database and is skipped; `wrangler deploy` creates the database, and the migration after deploy creates the tables. On later deploys, pending migrations run before the new code goes live.

Staging is a separate Worker with its own database and buckets:

```sh
pnpm --filter @kan/web deploy:staging
```

Staging and production each need their own build, because `NEXT_PUBLIC_*` values are compiled in. Set the staging values in the environment before running `deploy:staging`.

To serve on your own domain, add a custom domain to the `kan-flare` Worker in the dashboard (Workers & Pages → kan-flare → Settings → Domains), or add `routes` to `wrangler.jsonc`.

## MCP server (AI clients)

kan-flare includes an MCP server, so AI clients (Claude, Cursor, Codex, Copilot…) can read and manage boards. Each user creates an API key under **Settings → API keys**. On a self-hosted instance there's no plan requirement.

**Remote (HTTP).** Point the client at your instance:

```
URL:     https://kan.example.com/api/mcp
Header:  Authorization: Bearer kan_your_api_key
```

For example, in Claude Code:

```sh
claude mcp add --transport http kan https://kan.example.com/api/mcp \
  --header "Authorization: Bearer kan_your_api_key"
```

**Local (stdio).** Use upstream's npm package, pointed at your instance:

```json
{
  "mcpServers": {
    "kan": {
      "command": "npx",
      "args": ["-y", "@kan/mcp"],
      "env": {
        "KAN_BASE_URL": "https://kan.example.com",
        "KAN_API_TOKEN": "kan_your_api_key"
      }
    }
  }
}
```

The HTTP endpoint calls the app's own REST API through the `WORKER_SELF_REFERENCE` service binding, because a Worker can't reliably fetch its own public hostname.

## Operating it

- **Logs:** Workers Logs is on. Entries are structured (level, module, request ID, procedure, duration…) and searchable in the dashboard.
- **Backups:** D1 Time Travel keeps 30 days of point-in-time history on the paid plan. To restore:

  ```sh
  npx wrangler d1 time-travel restore kan-flare --timestamp=2026-10-08T12:00:00Z
  ```

- **Migrations:** after changing `packages/db/src/schema`, run `pnpm db:generate`, commit the new file in `packages/db/migrations`, and deploy.
- **Health:** `GET /api/v1/health` reports database and storage status.

## Local development

```sh
cp apps/web/.dev.vars.example apps/web/.dev.vars   # fill in BETTER_AUTH_SECRET
pnpm db:migrate                                    # local D1 in apps/web/.wrangler
pnpm dev                                           # next dev, with bindings
```

To run the real Workers build locally:

```sh
cd apps/web
npx opennextjs-cloudflare build && npx wrangler dev
```

Mail isn't sent locally. `wrangler dev` writes each message under `apps/web/.wrangler/tmp/email/` and logs where it put it.

## Tests

| Command | What it runs |
| --- | --- |
| `pnpm test` | Unit tests, plus integration tests against local D1 |
| `pnpm --filter @kan/e2e test:self-hosted` | Playwright against the Workers build in `wrangler dev`, on fresh local D1 and R2 |
| `node cloudflare-migration/smoke.mjs` | End-to-end API smoke test against a running Worker |

## Notes

- `patches/@opennextjs__aws@4.1.8.patch` fixes an OpenNext bug that dropped percent-encoding from query strings, so a parameter containing `&` was split in two. Remove the patch once an OpenNext release includes the fix.
- The full migration history, with the reasoning behind each change, is in [`cloudflare-migration/README.md`](cloudflare-migration/README.md).
