import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AnyD1Database } from "drizzle-orm/d1";
import { onTestFinished } from "vitest";
import { getPlatformProxy } from "wrangler";

import type { dbClient } from "@kan/db/client";
import { createD1Client } from "@kan/db/client";
import * as schema from "@kan/db/schema";

export type TestDbClient = dbClient;

type TestD1 = AnyD1Database & {
  batch: (statements: unknown[]) => Promise<unknown>;
  prepare: (sql: string) => unknown;
};

const MIGRATIONS_DIR = resolve(__dirname, "../../db/migrations");

/** The schema migrations, split into single statements. */
const migrationStatements = readdirSync(MIGRATIONS_DIR)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .flatMap((file) =>
    readFileSync(join(MIGRATIONS_DIR, file), "utf8")
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean),
  );

/**
 * Creates a fresh in-memory D1 database (Miniflare, the same engine as
 * `wrangler dev`) with migrations applied. Disposed when the test finishes.
 */
export async function createTestDb(): Promise<TestDbClient> {
  const proxy = await getPlatformProxy<{ DB: TestD1 }>({
    configPath: resolve(__dirname, "wrangler.test.jsonc"),
    persist: false,
  });
  onTestFinished(() => proxy.dispose());

  const d1 = proxy.env.DB;
  await d1.batch(migrationStatements.map((statement) => d1.prepare(statement)));

  return createD1Client(d1);
}

/**
 * Seeds a test database with a workspace and user for testing.
 * Returns the created entities for use in tests.
 */
export async function seedTestData(db: TestDbClient) {
  // Create a test user
  const [user] = await db
    .insert(schema.users)
    .values({
      id: crypto.randomUUID(),
      name: "Test User",
      email: "test@example.com",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  // Create a test workspace (publicId must be exactly 12 chars)
  const [workspace] = await db
    .insert(schema.workspaces)
    .values({
      publicId: "wstest123456",
      name: "Test Workspace",
      slug: "test-workspace",
      createdBy: user!.id,
      createdAt: new Date(),
    })
    .returning();

  // Add user as admin member of workspace
  await db.insert(schema.workspaceMembers).values({
    publicId: "wm1234567890",
    email: user!.email,
    workspaceId: workspace!.id,
    userId: user!.id,
    createdBy: user!.id,
    role: "admin",
    status: "active",
    createdAt: new Date(),
  });

  return { user: user!, workspace: workspace! };
}
