import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: "../../.env" });

const stripeEnv = (key: string, placeholder: string) =>
  process.env[key] || placeholder;

function resolveStripeListenSecret(apiKey: string): string | undefined {
  try {
    return execFileSync(
      "stripe",
      ["listen", "--print-secret", "--api-key", apiKey],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    return undefined;
  }
}

const trelloMockPort = process.env.TRELLO_MOCK_PORT ?? "4025";

// The app runs on the Cloudflare Workers runtime (`wrangler dev`) against a
// fresh local D1/R2 state for every run. Wrangler's output is teed to a log,
// which tests/support/mailpit-client.ts reads to find sent email.
const wranglerState = join(tmpdir(), "kan-e2e-wrangler-state");
const wranglerLog = join(tmpdir(), "kan-e2e-wrangler.log");
const betterAuthSecret =
  process.env.BETTER_AUTH_SECRET ?? "e2e-test-only-secret-not-for-prod-use";

/** Read by the Worker at runtime; passed with `wrangler dev --var`. */
const sharedVars: Record<string, string> = {
  BETTER_AUTH_SECRET: betterAuthSecret,
  DISABLE_RATE_LIMIT: "true",
  // wrangler.jsonc turns these off for production; mention-email.spec needs them.
  DISABLE_NOTIFICATION_EMAILS: "false",
  EMAIL_FROM: "kan-flare e2e <e2e@kan-test.local>",
  TRELLO_API_URL: `http://127.0.0.1:${trelloMockPort}`,
  TRELLO_APP_API_KEY: "e2e-mock-trello-key",
};

/** Compiled into the build (NEXT_PUBLIC_*) or needed by env validation. */
const sharedBuildEnv: Record<string, string> = {
  BETTER_AUTH_SECRET: betterAuthSecret,
  NEXT_PUBLIC_ALLOW_CREDENTIALS: "true",
  NEXT_PUBLIC_DISABLE_SIGN_UP: "false",
  NEXT_PUBLIC_DISABLE_EMAIL: "false",
};

const realStripeSecretKey =
  process.env.E2E_MODE === "cloud" &&
  process.env.STRIPE_SECRET_KEY &&
  process.env.STRIPE_SECRET_KEY !== "sk_test_e2e_placeholder"
    ? process.env.STRIPE_SECRET_KEY
    : undefined;

const stripeListenSecret = realStripeSecretKey
  ? resolveStripeListenSecret(realStripeSecretKey)
  : undefined;

type Mode = "self-hosted" | "cloud";
const modeConfig: Record<Mode, { port: string; env: Record<string, string> }> =
  {
    "self-hosted": {
      port: process.env.PORT ?? "3000",
      env: { NEXT_PUBLIC_KAN_ENV: "" },
    },
    cloud: {
      port: process.env.CLOUD_PORT ?? "3100",
      env: {
        NEXT_PUBLIC_KAN_ENV: "cloud",
        STRIPE_SECRET_KEY: stripeEnv(
          "STRIPE_SECRET_KEY",
          "sk_test_e2e_placeholder",
        ),
        STRIPE_WEBHOOK_SECRET:
          stripeListenSecret ??
          stripeEnv("STRIPE_WEBHOOK_SECRET", "whsec_e2e_placeholder"),
        STRIPE_WEBHOOK_SECRET_LEGACY:
          stripeListenSecret ??
          stripeEnv(
            "STRIPE_WEBHOOK_SECRET_LEGACY",
            "whsec_e2e_legacy_placeholder",
          ),
        STRIPE_TEAM_PLAN_MONTHLY_PRICE_ID: stripeEnv(
          "STRIPE_TEAM_PLAN_MONTHLY_PRICE_ID",
          "price_e2e_placeholder",
        ),
        STRIPE_TEAM_PLAN_YEARLY_PRICE_ID: stripeEnv(
          "STRIPE_TEAM_PLAN_YEARLY_PRICE_ID",
          "price_e2e_placeholder",
        ),
        STRIPE_PRO_PLAN_MONTHLY_PRICE_ID: stripeEnv(
          "STRIPE_PRO_PLAN_MONTHLY_PRICE_ID",
          "price_e2e_placeholder",
        ),
        STRIPE_PRO_PLAN_YEARLY_PRICE_ID: stripeEnv(
          "STRIPE_PRO_PLAN_YEARLY_PRICE_ID",
          "price_e2e_placeholder",
        ),
      },
    },
  };

const mode: Mode = (process.env.E2E_MODE as Mode | undefined) ?? "self-hosted";
const { port, env: modeEnv } = modeConfig[mode];

const remoteBaseURL = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = remoteBaseURL ?? `http://localhost:${port}`;

export default defineConfig({
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: process.env.CI ? [["html", { open: "never" }], ["github"]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: mode,
      testDir: `./tests/${mode}`,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: remoteBaseURL
    ? undefined
    : [
        {
          command: "node tests/support/trello-mock-server.js",
          url: `http://127.0.0.1:${trelloMockPort}/health`,
          reuseExistingServer: true,
          timeout: 10_000,
          env: { TRELLO_MOCK_PORT: trelloMockPort },
        },
        {
          command: [
            `rm -rf ${wranglerState}`,
            "pnpm --filter @kan/web exec opennextjs-cloudflare build",
            `pnpm --filter @kan/web exec wrangler d1 migrations apply kan-flare --local --persist-to ${wranglerState}`,
            // --local-upstream: without it, wrangler dev rewrites requests to the
            // production custom domain in wrangler.jsonc, and auth rejects the origin.
            `pnpm --filter @kan/web exec wrangler dev --port ${port} --local-upstream localhost:${port} --inspector-port 9459 --persist-to ${wranglerState} ${Object.entries(
              { ...sharedVars, NEXT_PUBLIC_BASE_URL: baseURL },
            )
              .map(([key, value]) => `--var ${key}:${JSON.stringify(value)}`)
              .join(" ")} 2>&1 | tee ${wranglerLog}`,
          ].join(" && "),
          cwd: "../..",
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 300_000,
          env: {
            ...sharedBuildEnv,
            NEXT_PUBLIC_BASE_URL: baseURL,
            ...modeEnv,
          },
        },
      ],
});
