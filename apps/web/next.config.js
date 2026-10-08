import { fileURLToPath } from "url";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import createJiti from "jiti";

// Import env files to validate at build time. Use jiti so we can load .ts files in here.
createJiti(fileURLToPath(import.meta.url))("./src/env");

/** @type {import("next").NextConfig} */
const config = {
  output:
    process.env.NEXT_PUBLIC_USE_STANDALONE_OUTPUT === "true"
      ? "standalone"
      : undefined,
  reactStrictMode: true,

  /** Exclude build tools and dev-only packages from the standalone output */
  outputFileTracingExcludes: {
    "**/*": [
      "@esbuild/**",
      "esbuild/**",
      "typescript/**",
      "webpack/**",
      "uglify-js/**",
      "terser/**",
    ],
  },

  /**
   * Packages that are only imported under the Workers condition, so Next's
   * file tracing misses them and the OpenNext Worker bundle can't resolve them.
   */
  outputFileTracingIncludes: {
    "/**": [
      "../../node_modules/uncrypto/**",
      "../../node_modules/@react-email/render/**",
      "../../node_modules/stripe/**",
      // Better Auth 1.7 resolves "workerd" export conditions (e.g.
      // @better-auth/core/instrumentation → pure.index.mjs) that Node-based
      // tracing doesn't follow.
      "../../node_modules/better-auth/dist/**",
      "../../node_modules/@better-auth/**",
    ],
  },

  /** Enables hot reloading for local packages without a build step */
  transpilePackages: [
    "@kan/api",
    "@kan/db",
    "@kan/shared",
    "@kan/auth",
    "@kan/stripe",
    "@kan/mcp",
  ],

  /** We already do linting and typechecking as separate tasks in CI */
  typescript: { ignoreBuildErrors: true },

  // temporarily ignore eslint errors during build until we fix all the errors sigh
  eslint: { ignoreDuringBuilds: true },

  /**
   * All images go through /api/image (src/utils/image-loader.ts), which
   * converts them once with Cloudflare Images and keeps the result in R2.
   * Which sources are allowed is decided there.
   */
  images: {
    loader: "custom",
    loaderFile: "./src/utils/image-loader.ts",
  },
  turbopack: {
    rules: {
      "*.svg": {
        loaders: ["@svgr/webpack"],
        as: "*.js",
      },
    },
  },

  experimental: {
    // instrumentationHook: true,
    swcPlugins: [["@lingui/swc-plugin", {}]],
  },

  async rewrites() {
    return [
      {
        source: "/settings",
        destination: "/settings/account",
      },
      // OAuth discovery (kan-flare is an OAuth server for MCP clients and
      // other apps); see src/pages/api/oauth/discovery.ts.
      .../** @type {[string, string][]} */ ([
        [
          "/.well-known/oauth-protected-resource",
          "doc=protected-resource&kind=mcp",
        ],
        [
          "/.well-known/oauth-protected-resource/api/mcp",
          "doc=protected-resource&kind=mcp",
        ],
        [
          "/.well-known/oauth-protected-resource/api/v1",
          "doc=protected-resource&kind=api",
        ],
        ["/.well-known/oauth-authorization-server", "doc=authorization-server"],
        [
          "/.well-known/oauth-authorization-server/api/auth",
          "doc=authorization-server",
        ],
        ["/.well-known/openid-configuration", "doc=openid-configuration"],
        [
          "/.well-known/openid-configuration/api/auth",
          "doc=openid-configuration",
        ],
      ]).map(([source, query]) => ({
        source,
        destination: `/api/oauth/discovery?${query}`,
      })),
    ];
  },
};

// Exposes Cloudflare bindings (D1, R2, …) to `next dev` through
// getCloudflareContext(). Skipped for `next build`: it loads this file in
// several workers at once, and each would start a local runtime on the same
// D1 state, failing with SQLITE_BUSY.
if (process.env.NODE_ENV !== "production") {
  // The Wrangler config lives at the repo root (the Deploy to Cloudflare
  // button needs it there).
  initOpenNextCloudflareForDev({
    configPath: "../../wrangler.jsonc",
    // Same local state as `pnpm db:migrate` (next to wrangler.jsonc).
    persist: { path: "../../.wrangler/state/v3" },
  });
}

export default config;
