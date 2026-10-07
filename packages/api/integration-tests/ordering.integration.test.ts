import { and, asc, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import * as boardRepo from "@kan/db/repository/board.repo";
import * as cardRepo from "@kan/db/repository/card.repo";
import * as checklistRepo from "@kan/db/repository/checklist.repo";
import * as listRepo from "@kan/db/repository/list.repo";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";
import * as schema from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

import type { TestDbClient } from "./test-db";
import { createTestDb, seedTestData } from "./test-db";

async function setup() {
  const db = await createTestDb();
  const { user, workspace } = await seedTestData(db);
  const [board] = await db
    .insert(schema.boards)
    .values({
      publicId: generateUID(),
      name: "Board",
      slug: "board",
      createdBy: user.id,
      workspaceId: workspace.id,
    })
    .returning();
  const listA = await listRepo.create(db, {
    name: "A",
    createdBy: user.id,
    boardId: board!.id,
  });
  const listB = await listRepo.create(db, {
    name: "B",
    createdBy: user.id,
    boardId: board!.id,
  });
  return { db, user, workspace, board: board!, listA: listA!, listB: listB! };
}

/** Card titles in a list, in index order, asserting indexes are 0..n-1. */
async function cardTitles(db: TestDbClient, listId: number) {
  const rows = await db
    .select({ title: schema.cards.title, index: schema.cards.index })
    .from(schema.cards)
    .where(and(eq(schema.cards.listId, listId), isNull(schema.cards.deletedAt)))
    .orderBy(asc(schema.cards.index));
  expect(rows.map((r) => r.index)).toEqual(rows.map((_, i) => i));
  return rows.map((r) => r.title);
}

async function listNames(db: TestDbClient, boardId: number) {
  const rows = await db
    .select({ name: schema.lists.name, index: schema.lists.index })
    .from(schema.lists)
    .where(
      and(eq(schema.lists.boardId, boardId), isNull(schema.lists.deletedAt)),
    )
    .orderBy(asc(schema.lists.index));
  expect(rows.map((r) => r.index)).toEqual(rows.map((_, i) => i));
  return rows.map((r) => r.name);
}

async function addCards(
  ctx: Awaited<ReturnType<typeof setup>>,
  listId: number,
  titles: string[],
  position: "start" | "end" = "end",
) {
  const created = [];
  for (const title of titles) {
    created.push(
      await cardRepo.create(ctx.db, {
        title,
        description: null,
        createdBy: ctx.user.id,
        listId,
        workspaceId: ctx.workspace.id,
        position,
      }),
    );
  }
  return created;
}

describe("card ordering on D1", () => {
  it("appends cards at the end and numbers them per workspace", async () => {
    const ctx = await setup();
    const created = await addCards(ctx, ctx.listA.id, ["a", "b", "c"]);

    expect(await cardTitles(ctx.db, ctx.listA.id)).toEqual(["a", "b", "c"]);
    expect(created.map((c) => c.cardNumber)).toEqual([1, 2, 3]);

    const activities = await ctx.db.select().from(schema.cardActivities);
    expect(activities.filter((a) => a.type === "card.created")).toHaveLength(3);
  });

  it("inserts at the start and shifts the rest down", async () => {
    const ctx = await setup();
    await addCards(ctx, ctx.listA.id, ["a", "b"]);
    await addCards(ctx, ctx.listA.id, ["first"], "start");

    expect(await cardTitles(ctx.db, ctx.listA.id)).toEqual(["first", "a", "b"]);
  });

  it("moves a card down and up within a list", async () => {
    const ctx = await setup();
    const [a] = await addCards(ctx, ctx.listA.id, ["a", "b", "c", "d"]);

    await cardRepo.reorder(ctx.db, {
      cardId: a!.id,
      newListId: undefined,
      newIndex: 2,
    });
    expect(await cardTitles(ctx.db, ctx.listA.id)).toEqual([
      "b",
      "c",
      "a",
      "d",
    ]);

    await cardRepo.reorder(ctx.db, {
      cardId: a!.id,
      newListId: undefined,
      newIndex: 0,
    });
    expect(await cardTitles(ctx.db, ctx.listA.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("moves a card to another list at a position and at the end", async () => {
    const ctx = await setup();
    const [a, b] = await addCards(ctx, ctx.listA.id, ["a", "b", "c"]);
    await addCards(ctx, ctx.listB.id, ["x", "y"]);

    const moved = await cardRepo.reorder(ctx.db, {
      cardId: b!.id,
      newListId: ctx.listB.id,
      newIndex: 1,
    });
    expect(moved?.title).toBe("b");
    expect(await cardTitles(ctx.db, ctx.listA.id)).toEqual(["a", "c"]);
    expect(await cardTitles(ctx.db, ctx.listB.id)).toEqual(["x", "b", "y"]);

    await cardRepo.reorder(ctx.db, {
      cardId: a!.id,
      newListId: ctx.listB.id,
      newIndex: undefined,
    });
    expect(await cardTitles(ctx.db, ctx.listA.id)).toEqual(["c"]);
    expect(await cardTitles(ctx.db, ctx.listB.id)).toEqual([
      "x",
      "b",
      "y",
      "a",
    ]);
  });

  it("closes the gap when a card is deleted", async () => {
    const ctx = await setup();
    const [, b] = await addCards(ctx, ctx.listA.id, ["a", "b", "c"]);

    const deleted = await cardRepo.softDelete(ctx.db, {
      cardId: b!.id,
      deletedAt: new Date(),
      deletedBy: ctx.user.id,
    });
    expect(deleted).toMatchObject({ id: b!.id, listId: ctx.listA.id });
    expect(await cardTitles(ctx.db, ctx.listA.id)).toEqual(["a", "c"]);
  });

  it("bulk-creates more cards than fit in one D1 statement", async () => {
    const ctx = await setup();
    await addCards(ctx, ctx.listA.id, ["existing"]);

    const incoming = Array.from({ length: 60 }, (_, i) => ({
      publicId: generateUID(),
      title: `bulk-${String(i).padStart(2, "0")}`,
      description: null,
      createdBy: ctx.user.id,
      listId: i % 2 === 0 ? ctx.listA.id : ctx.listB.id,
      workspaceId: ctx.workspace.id,
      index: i,
    }));
    const inserted = await cardRepo.bulkCreate(ctx.db, incoming);
    expect(inserted).toHaveLength(60);

    const titlesA = await cardTitles(ctx.db, ctx.listA.id);
    expect(titlesA[0]).toBe("existing");
    expect(titlesA).toHaveLength(31);
    expect(await cardTitles(ctx.db, ctx.listB.id)).toHaveLength(30);

    const numbers = (
      await ctx.db.select({ n: schema.cards.cardNumber }).from(schema.cards)
    )
      .map((r) => r.n)
      .sort((x, y) => x! - y!);
    expect(numbers).toEqual(Array.from({ length: 61 }, (_, i) => i + 1));

    const [ws] = await ctx.db
      .select({ counter: schema.workspaces.cardCounter })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, ctx.workspace.id));
    expect(ws?.counter).toBe(61);
  });

  it("links bulk label relationships beyond the parameter limit", async () => {
    const ctx = await setup();
    const created = await addCards(
      ctx,
      ctx.listA.id,
      Array.from({ length: 60 }, (_, i) => `c${i}`),
    );
    const [label] = await ctx.db
      .insert(schema.labels)
      .values({
        publicId: generateUID(),
        name: "L",
        boardId: ctx.board.id,
        createdBy: ctx.user.id,
      })
      .returning();

    await cardRepo.bulkCreateCardLabelRelationships(
      ctx.db,
      created.map((c) => ({ cardId: c.id, labelId: label!.id })),
    );
    const links = await ctx.db.select().from(schema.cardsToLabels);
    expect(links).toHaveLength(60);
  });
});

describe("list ordering on D1", () => {
  it("creates, reorders and deletes lists", async () => {
    const ctx = await setup();
    const c = await listRepo.create(ctx.db, {
      name: "C",
      createdBy: ctx.user.id,
      boardId: ctx.board.id,
    });
    expect(await listNames(ctx.db, ctx.board.id)).toEqual(["A", "B", "C"]);

    const moved = await listRepo.reorder(ctx.db, {
      listPublicId: c!.publicId,
      newIndex: 0,
    });
    expect(moved?.name).toBe("C");
    expect(await listNames(ctx.db, ctx.board.id)).toEqual(["C", "A", "B"]);

    await listRepo.softDeleteById(ctx.db, {
      listId: ctx.listA.id,
      deletedAt: new Date(),
      deletedBy: ctx.user.id,
    });
    expect(await listNames(ctx.db, ctx.board.id)).toEqual(["C", "B"]);
  });

  it("bulk-creates lists after the existing ones", async () => {
    const ctx = await setup();
    await listRepo.bulkCreate(
      ctx.db,
      Array.from({ length: 30 }, (_, i) => ({
        publicId: generateUID(),
        name: `L${String(i).padStart(2, "0")}`,
        createdBy: ctx.user.id,
        boardId: ctx.board.id,
        index: i,
      })),
    );
    const names = await listNames(ctx.db, ctx.board.id);
    expect(names.slice(0, 3)).toEqual(["A", "B", "L00"]);
    expect(names).toHaveLength(32);
  });
});

describe("checklist ordering on D1", () => {
  it("appends checklists and items, and reorders items", async () => {
    const ctx = await setup();
    const [card] = await addCards(ctx, ctx.listA.id, ["card"]);

    const first = await checklistRepo.create(ctx.db, {
      cardId: card!.id,
      name: "one",
      createdBy: ctx.user.id,
    });
    await checklistRepo.create(ctx.db, {
      cardId: card!.id,
      name: "two",
      createdBy: ctx.user.id,
    });
    const checklistRows = await ctx.db
      .select({ name: schema.checklists.name, index: schema.checklists.index })
      .from(schema.checklists)
      .orderBy(asc(schema.checklists.index));
    expect(checklistRows).toEqual([
      { name: "one", index: 0 },
      { name: "two", index: 1 },
    ]);

    const items = [];
    for (const title of ["i0", "i1", "i2"]) {
      items.push(
        await checklistRepo.createItem(ctx.db, {
          checklistId: first!.id,
          title,
          createdBy: ctx.user.id,
        }),
      );
    }

    const itemTitles = async () => {
      const rows = await ctx.db
        .select({
          title: schema.checklistItems.title,
          index: schema.checklistItems.index,
        })
        .from(schema.checklistItems)
        .where(isNull(schema.checklistItems.deletedAt))
        .orderBy(asc(schema.checklistItems.index));
      expect(rows.map((r) => r.index)).toEqual(rows.map((_, i) => i));
      return rows.map((r) => r.title);
    };
    expect(await itemTitles()).toEqual(["i0", "i1", "i2"]);

    await checklistRepo.reorderItem(ctx.db, {
      itemId: items[0]!.id,
      newIndex: 2,
    });
    expect(await itemTitles()).toEqual(["i1", "i2", "i0"]);

    const unchanged = await checklistRepo.reorderItem(ctx.db, {
      itemId: items[0]!.id,
      newIndex: 2,
    });
    expect(unchanged.title).toBe("i0");

    const bulk = await checklistRepo.bulkCreateItems(
      ctx.db,
      Array.from({ length: 40 }, (_, i) => ({
        checklistId: first!.id,
        title: `b${i}`,
        createdBy: ctx.user.id,
        index: i,
        completed: false,
      })),
    );
    expect(bulk).toHaveLength(40);
    expect(await itemTitles()).toHaveLength(43);
  });
});

describe("board copy and move on D1", () => {
  it("copies a board snapshot with lists, cards, labels and checklists", async () => {
    const ctx = await setup();
    const copy = await boardRepo.createFromSnapshot(ctx.db, {
      source: {
        name: "Template",
        labels: [
          { publicId: "srclabel0001", name: "Bug", colourCode: "#ff0000" },
        ],
        lists: [0, 1].map((li) => ({
          name: `list${li}`,
          index: li,
          cards: Array.from({ length: 20 }, (_, ci) => ({
            title: `l${li}c${ci}`,
            description: null,
            index: ci,
            labels: [
              { publicId: "srclabel0001", name: "Bug", colourCode: "#ff0000" },
            ],
            checklists: [
              {
                publicId: generateUID(),
                name: "todo",
                index: 0,
                items: [
                  {
                    publicId: generateUID(),
                    title: "x",
                    completed: true,
                    index: 0,
                  },
                  {
                    publicId: generateUID(),
                    title: "y",
                    completed: false,
                    index: 1,
                  },
                ],
              },
            ],
          })),
        })),
      },
      workspaceId: ctx.workspace.id,
      createdBy: ctx.user.id,
      slug: "template-copy",
      type: "template",
      sourceBoardId: ctx.board.id,
    });

    expect(copy.name).toBe("Template");
    const [newBoard] = await ctx.db
      .select()
      .from(schema.boards)
      .where(eq(schema.boards.publicId, copy.publicId));
    expect(await listNames(ctx.db, newBoard!.id)).toEqual(["list0", "list1"]);

    const newLists = await ctx.db
      .select()
      .from(schema.lists)
      .where(eq(schema.lists.boardId, newBoard!.id))
      .orderBy(asc(schema.lists.index));
    const titles = await cardTitles(ctx.db, newLists[0]!.id);
    expect(titles).toHaveLength(20);
    expect(titles[0]).toBe("l0c0");

    expect(await ctx.db.select().from(schema.cardsToLabels)).toHaveLength(40);
    expect(await ctx.db.select().from(schema.checklists)).toHaveLength(40);
    expect(await ctx.db.select().from(schema.checklistItems)).toHaveLength(80);
    const activities = await ctx.db.select().from(schema.cardActivities);
    expect(
      activities.filter((a) => a.sourceBoardId === ctx.board.id),
    ).toHaveLength(40 + 40 + 40 + 80);
  });

  it("moves a board to another workspace and clears card members", async () => {
    const ctx = await setup();
    const [card] = await addCards(ctx, ctx.listA.id, ["a"]);
    const [member] = await ctx.db
      .select()
      .from(schema.workspaceMembers)
      .limit(1);
    await cardRepo.createCardMemberRelationship(ctx.db, {
      cardId: card!.id,
      memberId: member!.id,
    });
    const [other] = await ctx.db
      .insert(schema.workspaces)
      .values({
        publicId: generateUID(),
        name: "Other",
        slug: "other",
        createdBy: ctx.user.id,
      })
      .returning();

    const moved = await boardRepo.moveToWorkspace(
      ctx.db,
      ctx.board.id,
      other!.id,
      "moved",
    );
    expect(moved.name).toBe("Board");
    const [board] = await ctx.db
      .select()
      .from(schema.boards)
      .where(eq(schema.boards.id, ctx.board.id));
    expect(board).toMatchObject({ workspaceId: other!.id, slug: "moved" });
    expect(
      await ctx.db.select().from(schema.cardToWorkspaceMembers),
    ).toHaveLength(0);
  });
});

describe("workspace deletion on D1", () => {
  it("hard-deletes a workspace that has members, roles and content", async () => {
    const ctx = await setup();
    await addCards(ctx, ctx.listA.id, ["a"]);
    const [role] = await ctx.db
      .insert(schema.workspaceRoles)
      .values({
        publicId: generateUID(),
        workspaceId: ctx.workspace.id,
        name: "custom",
        hierarchyLevel: 1,
      })
      .returning();
    await ctx.db
      .update(schema.workspaceMembers)
      .set({ roleId: role!.id })
      .where(eq(schema.workspaceMembers.workspaceId, ctx.workspace.id));

    await workspaceRepo.hardDelete(ctx.db, ctx.workspace.publicId);

    expect(await ctx.db.select().from(schema.workspaces)).toHaveLength(0);
    expect(await ctx.db.select().from(schema.workspaceMembers)).toHaveLength(0);
    expect(await ctx.db.select().from(schema.workspaceRoles)).toHaveLength(0);
    expect(await ctx.db.select().from(schema.cards)).toHaveLength(0);
  });
});
