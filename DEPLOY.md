# Deploying kan-flare to Cloudflare

kan-flare runs entirely on Cloudflare:

| Piece | Cloudflare product | Binding in `wrangler.jsonc` |
| --- | --- | --- |
| Web app and API (Next.js via OpenNext) | Workers | – |
| Database | D1 | `DB` |
| Avatars and attachments | R2 | `AVATARS`, `ATTACHMENTS` |
| Resized images | Images + R2 | `IMAGES`, `IMAGE_VARIANTS` |
| Email | Email Service | `EMAIL` |
| Rate limiting | Workers Rate Limiting | `RATE_LIMIT_100/300/600` |

None of these need creating by hand. Bindings without IDs are provisioned by `wrangler deploy` the first time, and reused afterwards.

There are two ways to deploy: the **Deploy to Cloudflare** button in the [README](README.md#with-the-button), which needs no local setup, or `pnpm run deploy` from a clone, described here. The root `wrangler.jsonc` is generic and shared by both; everything specific to your instance (sender, URL, secrets) lives in `.env`, or in the Worker's dashboard settings for a button deploy.

## Before the first deploy

1. **Account and tools.** The Workers Paid plan is recommended: kan-flare fits the free plan's 3 MiB bundle limit (about 2.7 MiB), but the free plan's CPU time and D1 limits leave little headroom. You also need Node.js 20+ and pnpm 9.

   ```sh
   pnpm install
   npx wrangler login
   ```

2. **Images.** Cloudflare Images transformations must be available on the account. They're billed per unique transformation each month. kan-flare stores every variant in R2, so each one is made only once.

3. **Email (optional, but needed for sign-in links and invites).** Mail is sent from a domain onboarded to Cloudflare Email Service:

   ```sh
   npx wrangler email sending enable mail.example.com
   ```

4. **Settings.** Copy `.env.example` to `.env` at the repository root and fill it in. At minimum:

   ```sh
   BETTER_AUTH_SECRET=...                       # openssl rand -base64 32
   NEXT_PUBLIC_BASE_URL=https://kan.example.com # optional; see "Your own domain"
   EMAIL_FROM="Kan <no-reply@mail.example.com>" # for email
   ```

   - **`NEXT_PUBLIC_*`** values are compiled into the build. Without `NEXT_PUBLIC_ALLOW_CREDENTIALS` and `NEXT_PUBLIC_DISABLE_SIGN_UP`, the build uses `true` for both: email and password sign-in, and closed sign-up.
   - **Everything else** that's non-empty is uploaded as a Worker secret with each deploy. Nothing is printed.
   - **`wrangler.jsonc`** holds only settings shared by every install (`LOG_LEVEL`). Keep instance settings out of it, so the deploy button keeps working for everyone.

   To change secrets without deploying:

   ```sh
   pnpm secrets:push --dry-run   # lists the names it would push
   pnpm secrets:push
   ```

## Closed sign-up and email

For a private instance:

```sh
# .env
NEXT_PUBLIC_DISABLE_SIGN_UP=true    # the default: only the first account and email invitees can sign up
DISABLE_NOTIFICATION_EMAILS=true    # no mention emails
```

- **The first person to sign up** on a fresh install gets an account even with sign-up disabled. They create the first workspace and are its admin. After that, sign-up is closed.
- **Adding people:** invite them by email from the workspace's Members page. An invitee can sign up because of the pending invitation. Invite links don't work while sign-up is closed, because the link's recipient has no invitation to match.
- **`DISABLE_NOTIFICATION_EMAILS`** stops mention emails only. Magic-link sign-in, invite and password-reset emails still go out, and mentions still show in the in-app notification bell (bottom of the sidebar) and as push notifications on devices that turned them on.
- **Leave `NEXT_PUBLIC_DISABLE_EMAIL` unset:** it hides magic-link sign-in and email invites.

## Deploy

```sh
pnpm run deploy
```

Use `pnpm run deploy`, not `pnpm deploy`, which is a built-in pnpm command. This runs `tools/deploy.mjs`, which:

1. Builds the Worker with OpenNext, reading `NEXT_PUBLIC_*` from `.env`.
2. If the D1 database already exists, applies pending migrations before the new code goes live. A failed migration stops the deploy.
3. Deploys with `--secrets-file`, so the secrets from `.env` ship with this version. Missing D1, R2 and other resources are created here. The secrets file is written to a private temp file and deleted afterwards; values are never printed.
4. Applies migrations again, which creates the tables on the first deploy.

Use this instead of passing `--secrets-file .env` yourself. The raw file would upload every `NEXT_PUBLIC_*` and empty value as a secret, and would clash with names set in `vars`.

`pnpm run build` builds only, and `pnpm run deploy --skip-build` deploys the last build. Button deploys (Workers Builds) run these two scripts: there's no `.env` there, so the secrets are the ones set on the Worker.

### Your own domain

Attach it once in the dashboard: **Workers & Pages** → **kan-flare** → **Settings** → **Domains & Routes** → **Add** → **Custom domain**. Cloudflare creates the DNS record and certificate; the domain's zone must be in the same account. Deploys don't remove it.

Then set `NEXT_PUBLIC_BASE_URL` to that address (in `.env`, or as a variable on the Worker for a button deploy), so links in emails always use it. Without it, the app uses whichever address each request came in on (`apps/web/worker.mjs`), which is what makes a fresh button deploy work on its `workers.dev` address.

## Push notifications

The installed app (the PWA: "Add to Home Screen" on iPhone and Android, or "Install" in desktop Chrome and Edge) can receive push notifications for mentions.

1. Generate the server keys once. They're written to `.env`, and the next deploy uploads them as secrets. The values aren't printed:

   ```sh
   pnpm vapid:generate
   ```

   Keep them. Replacing them (`--force`) invalidates every device's subscription, and people have to turn push on again.

2. Each person opens the installed app, opens the bell and turns on **Push notifications on this device**. On iPhone and iPad this needs iOS 16.4 or later, and the app must be opened from the home screen.

Tapping a notification opens the card. The app icon shows the unread count where the platform supports badges. Logging out removes that device's subscription. Without the keys, push is simply off and the bell works as before.

For a button deploy, generate the keys in a clone and add `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` as secrets on the Worker. `VAPID_SUBJECT` (optional) is the contact push services see; it defaults to the site's URL.

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
cp .dev.vars.example .dev.vars   # fill in BETTER_AUTH_SECRET
pnpm db:migrate                  # local D1 in .wrangler/
pnpm dev                                           # next dev, with bindings
```

To run the real Workers build locally:

```sh
cd apps/web
npx opennextjs-cloudflare build -c ../../wrangler.jsonc
npx wrangler dev -c ../../wrangler.jsonc --local-upstream localhost:8787
```

`--local-upstream` keeps requests on `localhost`. If you add a `routes` entry to `wrangler.jsonc`, plain `wrangler dev` rewrites every request to that host, and sign-in fails with "Invalid origin".

Mail isn't sent locally. `wrangler dev` writes each message under `.wrangler/tmp/email/` and logs where it put it.

## Tests

| Command | What it runs |
| --- | --- |
| `pnpm test` | Unit tests, plus integration tests against local D1 |
| `pnpm --filter @kan/e2e test:self-hosted` | Playwright against the Workers build in `wrangler dev`, on fresh local D1 and R2 |
| `node cloudflare-migration/smoke.mjs` | End-to-end API smoke test against a running Worker |

## Notes

- `patches/@opennextjs__aws@4.1.8.patch` fixes an OpenNext bug that dropped percent-encoding from query strings, so a parameter containing `&` was split in two. Remove the patch once an OpenNext release includes the fix.
- The full migration history, with the reasoning behind each change, is in [`cloudflare-migration/README.md`](cloudflare-migration/README.md).
