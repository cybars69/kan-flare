import { initAuth } from "@kan/auth/server";
import { createDrizzleClient } from "@kan/db/client";

/** One Better Auth instance and database client for the API routes. */
export const db = createDrizzleClient();
export const auth = initAuth(db);
