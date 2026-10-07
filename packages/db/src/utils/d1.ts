import type { SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { AnyD1Database } from "drizzle-orm/d1";
import { is, sql } from "drizzle-orm";
import { SQLiteRaw } from "drizzle-orm/sqlite-core/query-builders/raw";

import type { dbClient } from "../client";

/**
 * D1 rejects statements with more than 100 bound parameters
 * ("too many SQL variables").
 */
export const D1_MAX_BOUND_PARAMETERS = 100;

export type D1BatchItem = BatchItem<"sqlite">;

export const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

/**
 * Runs statements as one D1 batch. D1 has no interactive transactions, so a
 * batch is how several writes commit or roll back together.
 */
export const runBatch = async (db: dbClient, items: D1BatchItem[]) => {
  if (items.length === 0) return [];

  // drizzle-orm 0.42 bug: raw queries (`db.run(sql...)`) never get a prepared
  // statement, so batching one that has parameters fails with "Cannot read
  // properties of undefined (reading 'bind')". Attach the statement here.
  const client = (db as unknown as { $client: AnyD1Database }).$client as {
    prepare(query: string): unknown;
  };
  for (const item of items) {
    if (is(item, SQLiteRaw)) {
      const raw = item as unknown as SQLiteRaw<unknown> & { stmt?: unknown };
      raw.stmt ??= client.prepare(raw.getQuery().sql);
    }
  }

  return db.batch(items as [D1BatchItem, ...D1BatchItem[]]);
};

/**
 * Builds multi-row statements (usually INSERTs) that each stay under D1's
 * bound-parameter limit. `build` is called with a group of rows and must
 * return the statement for them.
 */
export const splitByParameters = <TRow, TItem extends D1BatchItem>(
  rows: readonly TRow[],
  build: (rows: TRow[]) => TItem & { toSQL(): { params: unknown[] } },
): TItem[] => {
  const statements: TItem[] = [];
  let group: TRow[] = [];
  let groupParams = 0;

  for (const row of rows) {
    const rowParams = build([row]).toSQL().params.length;
    if (group.length > 0 && groupParams + rowParams > D1_MAX_BOUND_PARAMETERS) {
      statements.push(build(group));
      group = [];
      groupParams = 0;
    }
    group.push(row);
    groupParams += rowParams;
  }
  if (group.length > 0) statements.push(build(group));

  return statements;
};

/** `(1, 2, 3)` for use after `IN`. */
export const idList = (ids: readonly number[]): SQL =>
  sql`(${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )})`;

/**
 * Rewrites `index` to 0..n-1 within each parent (list, board, checklist),
 * keeping the current order and breaking ties by id. Runs as the last
 * statement of a batch, so even a write that raced with ours cannot leave
 * gaps or duplicate positions.
 *
 * @param parentFilter what follows `IN`, e.g. `idList([1, 2])` or a subquery
 */
export const renumberIndexes = (
  table: "card" | "list" | "card_checklist" | "card_checklist_item",
  parentColumn: "listId" | "boardId" | "cardId" | "checklistId",
  parentFilter: SQL,
): SQL => {
  const t = sql.identifier(table);
  const parent = sql.identifier(parentColumn);
  return sql`
    WITH ordered AS (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY ${parent} ORDER BY "index", id) - 1 AS new_index
      FROM ${t}
      WHERE ${parent} IN ${parentFilter} AND "deletedAt" IS NULL
    )
    UPDATE ${t} SET "index" = ordered.new_index
    FROM ordered
    WHERE ${t}.id = ordered.id AND ${t}."index" != ordered.new_index`;
};

/** `(SELECT COALESCE(MAX("index"), -1) + 1 ...)`: the next free position. */
export const nextIndex = (
  table: "card" | "list" | "card_checklist" | "card_checklist_item",
  parentColumn: "listId" | "boardId" | "cardId" | "checklistId",
  parentId: number,
): SQL =>
  sql`(SELECT COALESCE(MAX("index"), -1) + 1 FROM ${sql.identifier(table)} WHERE ${sql.identifier(parentColumn)} = ${parentId} AND "deletedAt" IS NULL)`;
