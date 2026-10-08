import { env } from "~/env";

/**
 * The app's public URL. NEXT_PUBLIC_BASE_URL is compiled in when set at
 * build time; a "Deploy to Cloudflare" build has none, so the browser uses
 * the address it's on.
 */
export function getBaseUrl(): string {
  if (env.NEXT_PUBLIC_BASE_URL)
    return env.NEXT_PUBLIC_BASE_URL.replace(/\/$/, "");
  return typeof window === "undefined" ? "" : window.location.origin;
}
