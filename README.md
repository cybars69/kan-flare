> **kan-flare** is a fork of [Kan](https://github.com/kanbn/kan) that runs entirely on Cloudflare (Workers, D1, R2, Images, Email Service). To deploy it, see [`DEPLOY.md`](DEPLOY.md). The migration from upstream's Docker/Postgres setup is recorded in [`cloudflare-migration/README.md`](cloudflare-migration/README.md). Licensed under AGPL-3.0, like upstream; see [`NOTICE`](NOTICE). Feature descriptions below are upstream's.

![github-background](https://github.com/user-attachments/assets/f728f52e-bf67-4357-9ba2-c24c437488e3)

<div align="center">
  <h3 align="center">Kan</h3>
  <p>The open-source project management alternative to Trello.</p>
</div>

<p align="center">
  <a href="https://kan.bn/kan/roadmap">Roadmap</a>
  ·
  <a href="https://kan.bn">Website</a>
  ·
  <a href="https://docs.kan.bn">Docs</a>
  ·
  <a href="https://discord.gg/e6ejRb6CmT">Discord</a>
</p>

<div align="center">
  <a href="https://github.com/kanbn/kan/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/badge/license-AGPLv3-purple"></a>
</div>

## Features 💫

- 👁️ **Board Visibility**: Control who can view and edit your boards
- 🤝 **Workspace Members**: Invite members and collaborate with your team
- 🚀 **Trello Imports**: Easily import your Trello boards
- 🔍 **Labels & Filters**: Organise and find cards quickly
- 💬 **Comments**: Discuss and collaborate with your team
- 📝 **Activity Log**: Track all card changes with detailed activity history
- 🎨 **Templates** : Save time with reusable custom board templates
- ⚡️ **Integrations (coming soon)** : Connect your favourite tools

See our [roadmap](https://kan.bn/kan/roadmap) for upcoming features.

## Screenshot 👁️

<img width="1507" alt="hero-dark" src="https://github.com/user-attachments/assets/8490104a-cd5d-49de-afc2-152fd8a93119" />

## Made With 🛠️

- [Next.js](https://nextjs.org/?ref=kan.bn)
- [tRPC](https://trpc.io/?ref=kan.bn)
- [Better Auth](https://better-auth.com/?ref=kan.bn)
- [Tailwind CSS](https://tailwindcss.com/?ref=kan.bn)
- [Drizzle ORM](https://orm.drizzle.team/?ref=kan.bn)
- [React Email](https://react.email/?ref=kan.bn)

## Deploying to Cloudflare ☁️

kan-flare runs entirely on Cloudflare: Workers for the app, D1 for the database, R2 for files, Cloudflare Images for image resizing, Email Service for mail, and Workers Rate Limiting. One command builds, provisions anything missing and deploys:

```bash
pnpm --filter @kan/web deploy
```

See [DEPLOY.md](./DEPLOY.md) for first-time setup (email domain, secrets, build settings), staging, backups and local development.

## Local Development 🧑‍💻

1. Clone the repository (or fork)

```bash
git clone https://github.com/cybars69/kan-flare.git
```

2. Install dependencies

```bash
pnpm install
```

3. Copy `.env.example` to `.env` (build-time settings) and `apps/web/.dev.vars.example` to `apps/web/.dev.vars` (runtime settings), then fill them in
4. Migrate the local D1 database

```bash
pnpm db:migrate
```

5. Start the development server

```bash
pnpm dev
```

## Environment Variables 🔐

| Variable                                  | Description                                               | Required                                    | Example                                                     |
| ----------------------------------------- | --------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------- |
| `EMAIL_FROM`                              | Sender address on a domain onboarded to Email Service     | For Email                                   | `"Kan <hello@mail.kan.bn>"`                                 |
| `NEXT_PUBLIC_DISABLE_EMAIL`               | To disable all email features                             | For Email                                   | `true`                                                      |
| `NEXT_PUBLIC_BASE_URL`                    | Base URL of your installation                             | Yes                                         | `http://localhost:3000`                                     |
| `NEXT_API_BODY_SIZE_LIMIT`                | Maximum API request body size (defaults to 1mb)           | No                                          | `50mb`                                                      |
| `BETTER_AUTH_ALLOWED_DOMAINS`             | Comma-separated list of allowed domains for OIDC logins   | For OIDC/Social login                       | `example.com,subsidiary.com`                                |
| `BETTER_AUTH_SECRET`                      | Auth encryption secret                                    | Yes                                         | Random 32+ char string                                      |
| `BETTER_AUTH_TRUSTED_ORIGINS`             | Allowed callback origins                                  | No                                          | `http://localhost:3000,http://localhost:3001`               |
| `GOOGLE_CLIENT_ID`                        | Google OAuth client ID                                    | For Google login                            | `xxx.apps.googleusercontent.com`                            |
| `GOOGLE_CLIENT_SECRET`                    | Google OAuth client secret                                | For Google login                            | `xxx`                                                       |
| `DISCORD_CLIENT_ID`                       | Discord OAuth client ID                                   | For Discord login                           | `xxx`                                                       |
| `DISCORD_CLIENT_SECRET`                   | Discord OAuth client secret                               | For Discord login                           | `xxx`                                                       |
| `GITHUB_CLIENT_ID`                        | GitHub OAuth client ID                                    | For GitHub login                            | `xxx`                                                       |
| `GITHUB_CLIENT_SECRET`                    | GitHub OAuth client secret                                | For GitHub login                            | `xxx`                                                       |
| `OIDC_CLIENT_ID`                          | Generic OIDC client ID                                    | For OIDC login                              | `xxx`                                                       |
| `OIDC_CLIENT_SECRET`                      | Generic OIDC client secret                                | For OIDC login                              | `xxx`                                                       |
| `OIDC_DISCOVERY_URL`                      | OIDC discovery URL                                        | For OIDC login                              | `https://auth.example.com/.well-known/openid-configuration` |
| `TRELLO_APP_API_KEY`                      | Trello app API key                                        | For Trello import                           | `xxx`                                                       |
| `TRELLO_APP_API_SECRET`                   | Trello app API secret                                     | For Trello import                           | `xxx`                                                       |
| `AVATAR_UPLOAD_LIMIT`                      | Maximum avatar file size in bytes                         | For file uploads                            | `2097152` (2MB)                                             |
| `NEXT_PUBLIC_ALLOW_CREDENTIALS`           | Allow email & password login                              | For authentication                          | `true`                                                      |
| `NEXT_PUBLIC_DISABLE_SIGN_UP`             | Disable sign up                                           | For authentication                          | `false`                                                     |
| `NEXT_PUBLIC_WHITE_LABEL_HIDE_POWERED_BY` | Hide “Powered by kan.bn” on public boards (self-host)     | For white labelling                         | `true`                                                      |
| `KAN_ADMIN_API_KEY`                       | Admin API key for stats and admin endpoints               | For admin/monitoring                        | `your-secret-admin-key`                                     |
| `LOG_LEVEL`                               | Log verbosity level (debug, info, warn, error)            | No (defaults to debug in dev, info in prod) | `info`                                                      |

`NEXT_PUBLIC_*` values are compiled in at build time. Set them in `.env` on the machine that builds and deploys. Everything else is read at runtime: set secrets with `wrangler secret put` and other values as `vars` in `apps/web/wrangler.jsonc`. Storage, database, email and rate limiting use Cloudflare bindings and need no variables. See `.env.example` for the full list.

## MCP Server (AI Control) 🤖

Kan ships with a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that lets any MCP-compatible AI client (Claude Desktop, Codex, Cursor, GitHub Copilot, and others) read and control your Kan instance using natural language.

Run it with `npx`, no clone or global install required:

```bash
npx -y @kan/mcp
```

Configure it with two environment variables: `KAN_BASE_URL` (your Kan instance) and `KAN_API_TOKEN` (from **Settings → API Keys**). Then point your client's MCP config at the `npx -y @kan/mcp` command.

See the [MCP Server docs](https://docs.kan.bn/integrations/mcp-server) for per-client config (Claude Desktop, Codex, and others), example prompts, the full tool reference, and troubleshooting.

## Contributing 🤝

We welcome contributions! Please read our [contribution guidelines](CONTRIBUTING.md) before submitting a pull request.

## Contributors 👥

<a href="https://github.com/kanbn/kan/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=kanbn/kan" />
</a>

## Sponsors ❤️

[<img height="100" alt="image" src="https://github.com/user-attachments/assets/e331c71f-ac86-46a6-bceb-ce276de094b0" />](https://www.testmuai.com)

Proudly sponsored by [TestMu AI (formerly LambdaTest)](https://www.testmuai.com) - an AI-native testing cloud platform built for modern engineering teams. Covering everything from autonomous test creation and fast execution to testing AI agents like chatbots and voice assistants. If you're serious about testing, go check them out.

## License 📝

Kan is licensed under the [AGPLv3 license](LICENSE).

## Contact 📧

For support or to get in touch, please email [henry@kan.bn](mailto:henry@kan.bn) or join our [Discord server](https://discord.gg/e6ejRb6CmT).
