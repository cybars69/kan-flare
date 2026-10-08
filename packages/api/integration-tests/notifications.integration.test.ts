import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import * as cardRepo from "@kan/db/repository/card.repo";
import * as listRepo from "@kan/db/repository/list.repo";
import * as notificationRepo from "@kan/db/repository/notification.repo";
import * as schema from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

import { createTestDb, seedTestData } from "./test-db";

async function setup() {
  const db = await createTestDb();
  const { user: author, workspace } = await seedTestData(db);

  const [reader] = await db
    .insert(schema.users)
    .values({
      id: crypto.randomUUID(),
      name: "Reader",
      email: "reader@example.com",
      emailVerified: true,
    })
    .returning();
  await db.insert(schema.workspaceMembers).values({
    publicId: generateUID(),
    email: reader!.email,
    workspaceId: workspace.id,
    userId: reader!.id,
    createdBy: author.id,
    role: "member",
    status: "active",
  });

  const [board] = await db
    .insert(schema.boards)
    .values({
      publicId: generateUID(),
      name: "Roadmap",
      slug: "roadmap",
      createdBy: author.id,
      workspaceId: workspace.id,
    })
    .returning();
  const list = await listRepo.create(db, {
    name: "Todo",
    createdBy: author.id,
    boardId: board!.id,
  });
  const card = await cardRepo.create(db, {
    title: "Launch",
    description: null,
    createdBy: author.id,
    listId: list!.id,
    workspaceId: workspace.id,
    position: "end",
  });
  const [comment] = await db
    .insert(schema.comments)
    .values({
      publicId: generateUID(),
      comment: "hi @reader",
      cardId: card.id,
      createdBy: author.id,
    })
    .returning();

  const mention = (userId = reader!.id) =>
    notificationRepo.create(db, {
      type: "mention",
      userId,
      cardId: card.id,
      commentId: comment!.id,
    });

  return { db, author, reader: reader!, workspace, card, mention };
}

describe("notifications on D1", () => {
  it("pages newest first without gaps or overlap, with display fields", async () => {
    const { db, reader, mention } = await setup();
    for (let i = 0; i < 25; i++) await mention();

    const first = await notificationRepo.listForUser(db, {
      userId: reader.id,
      limit: 20,
    });
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).toBe(first.items[19]?.publicId);
    expect(first.items[0]).toMatchObject({
      type: "mention",
      cardTitle: "Launch",
      boardName: "Roadmap",
      workspaceName: "Test Workspace",
      actorName: "Test User",
      readAt: null,
    });

    const second = await notificationRepo.listForUser(db, {
      userId: reader.id,
      limit: 20,
      cursor: first.nextCursor,
    });
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();

    const all = [...first.items, ...second.items].map((n) => n.publicId);
    expect(new Set(all).size).toBe(25);
  });

  it("ignores a cursor that belongs to another user", async () => {
    const { db, author, reader, mention } = await setup();
    await mention();
    const other = await mention(author.id);

    const page = await notificationRepo.listForUser(db, {
      userId: reader.id,
      limit: 20,
      cursor: other!.publicId,
    });
    expect(page.items).toHaveLength(0);
  });

  it("counts unread and marks only the user's own notifications read", async () => {
    const { db, author, reader, mention } = await setup();
    const a = await mention();
    await mention();
    const authors = await mention(author.id);

    expect(await notificationRepo.getVisibleUnreadCount(db, reader.id)).toBe(2);

    const marked = await notificationRepo.markAsReadForUser(db, {
      userId: reader.id,
      publicIds: [a!.publicId, authors!.publicId],
    });
    expect(marked).toBe(1);
    expect(await notificationRepo.getVisibleUnreadCount(db, reader.id)).toBe(1);
    expect(await notificationRepo.getVisibleUnreadCount(db, author.id)).toBe(1);

    expect(await notificationRepo.markAllAsReadForUser(db, reader.id)).toBe(1);
    expect(await notificationRepo.getVisibleUnreadCount(db, reader.id)).toBe(0);
  });

  it("hides notifications for deleted cards and workspaces the user left", async () => {
    const { db, reader, workspace, card, mention } = await setup();
    await mention();
    expect(await notificationRepo.getVisibleUnreadCount(db, reader.id)).toBe(1);

    await db
      .update(schema.cards)
      .set({ deletedAt: new Date() })
      .where(eq(schema.cards.id, card.id));
    expect(await notificationRepo.getVisibleUnreadCount(db, reader.id)).toBe(0);
    expect(
      (await notificationRepo.listForUser(db, { userId: reader.id, limit: 20 }))
        .items,
    ).toHaveLength(0);

    await db
      .update(schema.cards)
      .set({ deletedAt: null })
      .where(eq(schema.cards.id, card.id));
    await db
      .update(schema.workspaceMembers)
      .set({ status: "removed" })
      .where(eq(schema.workspaceMembers.userId, reader.id));
    expect(await notificationRepo.getVisibleUnreadCount(db, reader.id)).toBe(0);
    expect(workspace.id).toBeGreaterThan(0);
  });

  it("walks an index for the page instead of sorting", async () => {
    const { db, reader, mention } = await setup();
    for (let i = 0; i < 5; i++) await mention();

    const query = db
      .select({ id: schema.notifications.id })
      .from(schema.notifications)
      .where(
        sql`${schema.notifications.userId} = ${reader.id} AND ${schema.notifications.deletedAt} IS NULL`,
      )
      .orderBy(sql`${schema.notifications.id} DESC`)
      .limit(21);
    const { sql: text, params } = query.toSQL();
    const plan = (await db.all(
      sql.raw(
        `EXPLAIN QUERY PLAN ${text.replace(/\?/g, () => {
          const value = params.shift();
          return typeof value === "string" ? `'${value}'` : String(value);
        })}`,
      ),
    )) as { detail: string }[];
    const details = plan.map((row) => row.detail).join(" | ");

    expect(details).toMatch(
      /USING (COVERING )?INDEX notification_user_deleted_idx/,
    );
    expect(details).not.toMatch(/TEMP B-TREE/);
  });
});
