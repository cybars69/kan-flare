<div align="center">
  <h1>kan-flare</h1>
  <p><strong>Open-source kanban boards that run entirely on Cloudflare.</strong><br/>
  A fork of <a href="https://github.com/kanbn/kan">Kan</a>, the open-source Trello alternative, rebuilt for Workers, D1 and R2.</p>

  <p>
    <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/cybars69/kan-flare/tree/workers"><img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare" /></a>
  </p>

  <p>
    <a href="DEPLOY.md">Deploy guide</a>
    ·
    <a href="#local-development">Local development</a>
    ·
    <a href="cloudflare-migration/README.md">How it was ported</a>
    ·
    <a href="LICENSE"><img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPLv3-purple" align="center"></a>
  </p>
</div>

## Why kan-flare

Upstream Kan runs as a Node server with Postgres, S3, SMTP and Redis. kan-flare runs the same app on Cloudflare alone, so there are no servers or databases to look after:

| Piece                          | Runs on                                                                |
| ------------------------------ | ---------------------------------------------------------------------- |
| Web app and API (Next.js)      | Cloudflare Workers, via [OpenNext](https://opennext.js.org/cloudflare) |
| Database                       | D1 (SQLite)                                                            |
| Avatars and attachments        | R2                                                                     |
| Image resizing                 | Cloudflare Images, with each size stored in R2                         |
| Email (sign-in links, invites) | Cloudflare Email Service                                               |
| Rate limiting                  | Workers Rate Limiting                                                  |

Everything is created for you on the first deploy: there's nothing to provision by hand.

## Features

**From Kan**

- **Boards, lists and cards** with labels, checklists, due dates, comments, attachments and members
- **Workspaces** with roles and permissions, public or private boards, and templates
- **Activity log** of every card change
- **Trello import**
- **Search, filters and calendar view**
- **API keys and webhooks**

**Added in kan-flare**

- **Private by default.** Only the first account (which becomes the admin) and people invited by email can sign up.
- **Notification bell.** Mentions show in an in-app notification list, with unread counts and infinite scroll.
- **Push notifications** on the installed app (iPhone and iPad on iOS 16.4+, Android, desktop Chrome and Edge). Tapping one opens the card, and the app icon shows the unread count.
- **Built-in MCP server.** Connect Claude, Cursor or another AI client to `https://<your-app>/api/mcp` with an API key.
- **Quiet email.** One switch turns off mention emails, while sign-in links and invites keep working.

## Deploy

### With the button

1. Click **Deploy to Cloudflare** above, and sign in to Cloudflare and GitHub. Cloudflare copies this repository into your GitHub account and connects it to Workers Builds, so every push to your copy redeploys it.
2. Fill in the form:
   - **`BETTER_AUTH_SECRET`**: a random string of 32 or more characters, for example from `openssl rand -base64 32`. Keep it: changing it signs everyone out.
   - Keep the suggested Worker name (`kan-flare`) and resource names, unless you also update `wrangler.jsonc` in your copy.
3. Deploy. The first build takes a few minutes; the database tables are created during the deploy.
4. Open the `*.workers.dev` address it gives you and **sign up. The first account becomes the admin.** After that, sign-up is closed: add people from the workspace's **Members** page.

Optional, afterwards (Worker → **Settings** → **Variables and secrets**, then redeploy):

| To get                                              | Do this                                                                                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Email** (sign-in links, invites, password resets) | Onboard a sending domain under **Email** → **Email Sending**, then add `EMAIL_FROM`, for example `Kan <no-reply@mail.example.com>`.               |
| **Your own domain**                                 | Worker → **Settings** → **Domains & Routes** → **Add** → **Custom domain**. Then add `NEXT_PUBLIC_BASE_URL` = `https://tasks.example.com`.        |
| **Push notifications**                              | Generate a key pair (`pnpm vapid:generate` in a clone, or any VAPID key generator) and add `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` as secrets. |
| **Social sign-in**                                  | Add the provider's client ID and secret (see [Settings](#settings)).                                                                              |

Requirements: Cloudflare Images must be available on the account. The Workers Paid plan is recommended: the app fits the free plan's 3 MiB limit (about 2.7 MiB), but the free plan's CPU and D1 limits leave little headroom.

### From your machine

```bash
git clone https://github.com/cybars69/kan-flare.git && cd kan-flare
git checkout workers
pnpm install
npx wrangler login
cp .env.example .env    # then fill it in: at least BETTER_AUTH_SECRET
pnpm run deploy
```

`pnpm run deploy` builds the app, applies database migrations, uploads the secrets from `.env` with the new version and migrates again. Missing D1 databases and R2 buckets are created on the first run. Use `pnpm run deploy`, not `pnpm deploy`: the latter is a built-in pnpm command.

[`DEPLOY.md`](DEPLOY.md) covers the details: email, closed sign-up, custom domains, push notifications, the MCP server, backups and logs.

## Settings

Set these in `.env` for `pnpm run deploy`, or under the Worker's **Variables and secrets** for a button deploy. Values starting with `NEXT_PUBLIC_` are compiled into the build; set them in `.env` or as Workers Builds build variables. Storage, database, email and rate limiting use Cloudflare bindings and need no settings.

| Variable                                                     | What it does                                                                                          | Needed for      |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | --------------- |
| `BETTER_AUTH_SECRET`                                         | Signs sign-in sessions (32+ random characters)                                                        | Always          |
| `NEXT_PUBLIC_BASE_URL`                                       | The app's public URL. Without it, the app uses the address it's served on.                            | Custom domains  |
| `EMAIL_FROM`                                                 | Sender, on a domain onboarded to Email Service, e.g. `"Kan <no-reply@mail.example.com>"`              | Email           |
| `DISABLE_NOTIFICATION_EMAILS`                                | `true` stops mention emails; sign-in, invite and reset emails still send                              | Optional        |
| `NEXT_PUBLIC_DISABLE_EMAIL`                                  | `true` hides magic-link sign-in and email invites                                                     | Optional        |
| `NEXT_PUBLIC_ALLOW_CREDENTIALS`                              | Email and password sign-in. Defaults to `true`.                                                       | Optional        |
| `NEXT_PUBLIC_DISABLE_SIGN_UP`                                | Close sign-up, except for the first account and invitees. Defaults to `true`.                         | Optional        |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`                      | Push notification keys, from `pnpm vapid:generate`. Replacing them drops every device's subscription. | Push            |
| `VAPID_SUBJECT`                                              | Contact for push services (`mailto:` or `https://`). Defaults to the app's URL.                       | Optional        |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                   | Google sign-in                                                                                        | Google sign-in  |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`                   | GitHub sign-in                                                                                        | GitHub sign-in  |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`                 | Discord sign-in                                                                                       | Discord sign-in |
| `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_DISCOVERY_URL` | Any OpenID Connect provider                                                                           | OIDC sign-in    |
| `BETTER_AUTH_ALLOWED_DOMAINS`                                | Comma-separated email domains allowed to use social or OIDC sign-in                                   | Optional        |
| `BETTER_AUTH_TRUSTED_ORIGINS`                                | Extra origins allowed to call the auth API                                                            | Optional        |
| `TRELLO_APP_API_KEY`, `TRELLO_APP_API_SECRET`                | Trello import                                                                                         | Trello import   |
| `AVATAR_UPLOAD_LIMIT`                                        | Largest avatar in bytes (default 2 MB)                                                                | Optional        |
| `NEXT_PUBLIC_WHITE_LABEL_HIDE_POWERED_BY`                    | `true` hides "Powered by" on public boards                                                            | Optional        |
| `KAN_ADMIN_API_KEY`                                          | Key for the admin and stats endpoints                                                                 | Optional        |
| `LOG_LEVEL`                                                  | `debug`, `info`, `warn` or `error` (default `info` in production)                                     | Optional        |

[`.env.example`](.env.example) lists every setting with comments.

## Connect an AI client (MCP)

kan-flare serves a [Model Context Protocol](https://modelcontextprotocol.io) endpoint, so AI clients can read and manage your boards. Create a key under **Settings → API keys**, then:

```
URL:     https://<your-app>/api/mcp
Header:  Authorization: Bearer kan_your_api_key
```

In Claude Code: `claude mcp add --transport http kan https://<your-app>/api/mcp --header "Authorization: Bearer kan_…"`. In Claude's custom connector dialog, choose **No sign-in** and add the header. There's no OAuth sign-in: the API key is the sign-in.

## Local development

You need Node.js 20+ and pnpm 9.

```bash
pnpm install
cp .dev.vars.example .dev.vars   # fill in BETTER_AUTH_SECRET, uncomment the local lines
pnpm db:migrate                  # creates the local D1 database
pnpm dev                         # http://localhost:3000, with local D1 and R2
```

To run the real Workers build locally:

```bash
cd apps/web
npx opennextjs-cloudflare build -c ../../wrangler.jsonc
npx wrangler dev -c ../../wrangler.jsonc --local-upstream localhost:8787
```

Mail isn't sent locally: `wrangler dev` saves each message to a file and logs where it put it.

### Tests and checks

| Command                       | What it runs                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`                   | Unit tests, plus integration tests against local D1                                                                               |
| `pnpm test:e2e:self-hosted`   | Playwright against the Workers build in `wrangler dev`. Run `pnpm --filter @kan/e2e exec playwright install chromium` once first. |
| `pnpm lint`, `pnpm typecheck` | Lint and type checks                                                                                                              |

### Project layout

```
apps/web/          Next.js app (pages, components) and the Worker entry, worker.mjs
packages/api/      tRPC routers, REST (OpenAPI) and MCP
packages/db/       Drizzle schema, D1 migrations and repositories
packages/auth/     Better Auth setup
packages/email/    Email templates and sending
packages/shared/   R2 storage and shared helpers
packages/e2e/      Playwright tests
tools/             Deploy, secrets and key scripts
wrangler.jsonc     Cloudflare config (at the root so the deploy button finds it)
```

[`AGENTS.md`](AGENTS.md) has the coding conventions and the Cloudflare runtime rules (no interactive transactions, D1 parameter limits and so on).

## Credits and license

kan-flare is based on [Kan](https://github.com/kanbn/kan) by the Kan team and contributors. If you want hosted Kan, use [kan.bn](https://kan.bn); bugs that also exist upstream belong in the [upstream repository](https://github.com/kanbn/kan).

Like Kan, kan-flare is licensed under the [GNU AGPL v3](LICENSE): if you run a modified version for others, you must offer them its source. See [`NOTICE`](NOTICE) for copyright details. "Kan" and its logo belong to their owners; kan-flare isn't affiliated with or endorsed by them.
