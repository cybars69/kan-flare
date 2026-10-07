import { type Config } from "drizzle-kit";

// Schema lives in D1 (SQLite). `drizzle-kit generate` needs no credentials;
// `studio` and `push` against the remote database use the D1 HTTP API.
export default {
  schema: "./src/schema",
  out: "./migrations",
  dialect: "sqlite",
  driver: "d1-http",
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    databaseId: process.env.CLOUDFLARE_D1_DATABASE_ID ?? "",
    token: process.env.CLOUDFLARE_D1_TOKEN ?? "",
  },
  migrations: {
    prefix: "index",
  },
} satisfies Config;
