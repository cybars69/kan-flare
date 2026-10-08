import type { AnyD1Database, DrizzleD1Database } from "drizzle-orm/d1";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";

import * as schema from "./schema";

export type dbClient = DrizzleD1Database<typeof schema>;

/** Wraps a D1 binding (or Miniflare's D1, in tests) in a Drizzle client. */
export const createD1Client = (binding: AnyD1Database): dbClient =>
  drizzle(binding, { schema });

const clients = new WeakMap<object, dbClient>();

const clientForCurrentRequest = (): dbClient => {
  const { env } = getCloudflareContext() as unknown as {
    env: { DB?: object };
  };
  const binding = env.DB;
  if (!binding) {
    throw new Error(
      "No D1 binding named DB. Check d1_databases in wrangler.jsonc.",
    );
  }
  let client = clients.get(binding);
  if (!client) {
    client = createD1Client(binding as AnyD1Database);
    clients.set(binding, client);
  }
  return client;
};

/**
 * Returns a client that resolves the D1 binding from the Cloudflare request
 * context each time it is used. Workers only expose bindings inside a request,
 * so this lets callers create the client at module scope as they did with
 * Postgres.
 */
export const createDrizzleClient = (): dbClient =>
  new Proxy({} as dbClient, {
    get(_target, prop) {
      const client = clientForCurrentRequest();
      const value: unknown = Reflect.get(client, prop, client);
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(client)
        : value;
    },
  });
