import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Lets work finish after the response is sent. On Workers, promises that
 * aren't awaited are cut off once the response goes out unless they are
 * registered with `waitUntil`. Outside a Worker request (tests), the promise
 * simply runs.
 */
export function runInBackground(promise: Promise<unknown>) {
  try {
    const { ctx } = getCloudflareContext() as unknown as {
      ctx: { waitUntil(promise: Promise<unknown>): void };
    };
    ctx.waitUntil(promise);
  } catch {
    // Not inside a Cloudflare request.
  }
}
