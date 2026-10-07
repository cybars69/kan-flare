import { and, count, desc, eq, isNull, sql } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import { lists } from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

import {
  idList,
  nextIndex,
  renumberIndexes,
  runBatch,
  splitByParameters,
} from "../utils/d1";

export const getCount = async (db: dbClient) => {
  const result = await db
    .select({ count: count() })
    .from(lists)
    .where(isNull(lists.deletedAt));

  return result[0]?.count ?? 0;
};

export const create = async (
  db: dbClient,
  listInput: {
    name: string;
    createdBy: string;
    boardId: number;
    importId?: number;
  },
) => {
  // The position comes from a subquery, so the insert needs no prior read.
  const [result] = await db
    .insert(lists)
    .values({
      publicId: generateUID(),
      name: listInput.name,
      createdBy: listInput.createdBy,
      boardId: listInput.boardId,
      index: nextIndex("list", "boardId", listInput.boardId),
      importId: listInput.importId,
    })
    .returning({
      id: lists.id,
      publicId: lists.publicId,
      boardId: lists.boardId,
      name: lists.name,
    });

  if (!result)
    throw new Error(`Failed to create list for board ${listInput.boardId}`);

  return result;
};

export const bulkCreate = async (
  db: dbClient,
  listInput: {
    publicId: string;
    name: string;
    createdBy: string;
    boardId: number;
    index: number;
    importId?: number;
  }[],
) => {
  if (listInput.length === 0) return [];

  // Group incoming rows by board to compute safe, sequential indices per board
  const byBoard = new Map<number, typeof listInput>();
  for (const item of listInput) {
    const arr = byBoard.get(item.boardId) ?? [];
    arr.push(item);
    byBoard.set(item.boardId, arr);
  }

  const allValuesToInsert: {
    publicId: string;
    name: string;
    createdBy: string;
    boardId: number;
    index: number;
    importId?: number;
  }[] = [];

  // For each board, append incoming lists after the current max index, preserving their relative order
  for (const [boardId, items] of byBoard.entries()) {
    const last = await db.query.lists.findFirst({
      columns: { index: true },
      where: and(eq(lists.boardId, boardId), isNull(lists.deletedAt)),
      orderBy: [desc(lists.index)],
    });

    let next = last ? last.index + 1 : 0;

    // Sort incoming by their provided index to preserve Trello order, then reassign sequential indices
    const sorted = [...items].sort((a, b) => a.index - b.index);
    for (const it of sorted) {
      allValuesToInsert.push({
        publicId: it.publicId,
        name: it.name,
        createdBy: it.createdBy,
        boardId: it.boardId,
        index: next++,
        importId: it.importId,
      });
    }
  }

  // Insert in parameter-limited groups, then renumber in the same batch in
  // case another write raced with our reads.
  const inserts = splitByParameters(allValuesToInsert, (rows) =>
    db.insert(lists).values(rows).returning(),
  );
  const results = await runBatch(db, [
    ...inserts,
    db.run(renumberIndexes("list", "boardId", idList([...byBoard.keys()]))),
  ]);

  return (
    results.slice(0, inserts.length) as (typeof lists.$inferSelect)[][]
  ).flat();
};

export const getByPublicId = async (db: dbClient, listPublicId: string) => {
  return db.query.lists.findFirst({
    columns: {
      id: true,
      publicId: true,
      name: true,
      boardId: true,
      index: true,
    },
    where: and(eq(lists.publicId, listPublicId), isNull(lists.deletedAt)),
  });
};

export const getWithCardsByPublicId = async (
  db: dbClient,
  listPublicId: string,
) => {
  return db.query.lists.findFirst({
    columns: {
      id: true,
    },
    with: {
      cards: {
        columns: {
          index: true,
        },
        where: isNull(lists.deletedAt),
        orderBy: [desc(lists.index)],
      },
    },
    where: and(eq(lists.publicId, listPublicId), isNull(lists.deletedAt)),
  });
};

export const update = async (
  db: dbClient,
  listInput: {
    name: string;
  },
  args: {
    listPublicId: string;
  },
) => {
  const [result] = await db
    .update(lists)
    .set({ name: listInput.name })
    .where(and(eq(lists.publicId, args.listPublicId), isNull(lists.deletedAt)))
    .returning({
      publicId: lists.publicId,
      name: lists.name,
    });

  return result;
};

export const reorder = async (
  db: dbClient,
  args: {
    listPublicId: string;
    newIndex: number;
  },
) => {
  const list = await db.query.lists.findFirst({
    columns: {
      id: true,
      boardId: true,
      index: true,
    },
    where: eq(lists.publicId, args.listPublicId),
  });

  if (!list)
    throw new Error(`List not found for public ID ${args.listPublicId}`);

  const results = await runBatch(db, [
    db.run(sql`
      UPDATE list
      SET "index" =
        CASE
          WHEN id = ${list.id} THEN ${args.newIndex}
          WHEN ${list.index} < ${args.newIndex} AND "index" > ${list.index} AND "index" <= ${args.newIndex} THEN "index" - 1
          WHEN ${list.index} > ${args.newIndex} AND "index" >= ${args.newIndex} AND "index" < ${list.index} THEN "index" + 1
          ELSE "index"
        END
      WHERE "boardId" = ${list.boardId} AND "deletedAt" IS NULL`),
    db.run(renumberIndexes("list", "boardId", idList([list.boardId]))),
    db.query.lists.findFirst({
      columns: {
        publicId: true,
        name: true,
      },
      where: eq(lists.publicId, args.listPublicId),
    }),
  ]);

  return results[2] as { publicId: string; name: string } | undefined;
};

export const softDeleteAllByBoardId = async (
  db: dbClient,
  args: {
    boardId: number;
    deletedAt: Date;
    deletedBy: string;
  },
) => {
  const result = await db
    .update(lists)
    .set({ deletedAt: args.deletedAt, deletedBy: args.deletedBy })
    .where(and(eq(lists.boardId, args.boardId), isNull(lists.deletedAt)))
    .returning({
      id: lists.id,
    });

  return result;
};

export const softDeleteById = async (
  db: dbClient,
  args: {
    listId: number;
    deletedAt: Date;
    deletedBy: string;
  },
) => {
  const [deleted] = await runBatch(db, [
    db
      .update(lists)
      .set({ deletedAt: args.deletedAt, deletedBy: args.deletedBy })
      .where(and(eq(lists.id, args.listId), isNull(lists.deletedAt)))
      .returning({
        id: lists.id,
        index: lists.index,
        boardId: lists.boardId,
      }),
    db.run(
      renumberIndexes(
        "list",
        "boardId",
        sql`(SELECT "boardId" FROM list WHERE id = ${args.listId})`,
      ),
    ),
  ]);

  const [result] = deleted as { id: number; index: number; boardId: number }[];
  if (!result) throw new Error(`Unable to soft delete list ID ${args.listId}`);

  return result;
};

export const getWorkspaceAndListIdByListPublicId = async (
  db: dbClient,
  listPublicId: string,
) => {
  const result = await db.query.lists.findFirst({
    columns: { id: true, name: true, createdBy: true },
    where: and(eq(lists.publicId, listPublicId), isNull(lists.deletedAt)),
    with: {
      board: {
        columns: {
          publicId: true,
          workspaceId: true,
          name: true,
        },
      },
    },
  });

  return result
    ? {
        id: result.id,
        publicId: listPublicId,
        name: result.name,
        createdBy: result.createdBy,
        workspaceId: result.board.workspaceId,
        boardPublicId: result.board.publicId,
        boardName: result.board.name,
      }
    : null;
};
