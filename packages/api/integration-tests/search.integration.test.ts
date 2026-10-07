import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import * as cardRepo from "@kan/db/repository/card.repo";
import * as listRepo from "@kan/db/repository/list.repo";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";
import * as schema from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

import { createTestDb, seedTestData } from "./test-db";

async function setup() {
  const db = await createTestDb();
  const { user, workspace } = await seedTestData(db);
  await db
    .update(schema.workspaces)
    .set({ cardPrefix: "KAN" })
    .where(eq(schema.workspaces.id, workspace.id));

  const [board] = await db
    .insert(schema.boards)
    .values({
      publicId: generateUID(),
      name: "Marketing Roadmap",
      slug: "marketing",
      createdBy: user.id,
      workspaceId: workspace.id,
    })
    .returning();
  const list = await listRepo.create(db, {
    name: "Todo",
    createdBy: user.id,
    boardId: board!.id,
  });
  for (const title of [
    "Launch plan",
    "Plan the launch party",
    "Write launch blog post",
    "100% coverage",
    "Unrelated",
  ]) {
    await cardRepo.create(db, {
      title,
      description: null,
      createdBy: user.id,
      listId: list!.id,
      workspaceId: workspace.id,
      position: "end",
    });
  }
  return { db, workspace };
}

describe("workspace search on D1", () => {
  it("matches every word in any order, case-insensitively", async () => {
    const { db, workspace } = await setup();
    const results = await workspaceRepo.searchBoardsAndCards(
      db,
      workspace.id,
      "LAUNCH plan",
    );
    const titles = results.filter((r) => r.type === "card").map((r) => r.title);
    expect(titles).toEqual(["Launch plan", "Plan the launch party"]);
  });

  it("ranks prefix matches above other substring matches", async () => {
    const { db, workspace } = await setup();
    const results = await workspaceRepo.searchBoardsAndCards(
      db,
      workspace.id,
      "launch",
    );
    const titles = results.filter((r) => r.type === "card").map((r) => r.title);
    expect(titles[0]).toBe("Launch plan");
    expect(titles).toHaveLength(3);
  });

  it("finds boards by name", async () => {
    const { db, workspace } = await setup();
    const results = await workspaceRepo.searchBoardsAndCards(
      db,
      workspace.id,
      "roadmap",
    );
    expect(results.find((r) => r.type === "board")?.title).toBe(
      "Marketing Roadmap",
    );
  });

  it("finds a card by ticket id", async () => {
    const { db, workspace } = await setup();
    const results = await workspaceRepo.searchBoardsAndCards(
      db,
      workspace.id,
      "kan-2",
    );
    expect(results.map((r) => r.title)).toEqual(["Plan the launch party"]);
  });

  it("treats % and _ in the query literally", async () => {
    const { db, workspace } = await setup();
    const percent = await workspaceRepo.searchBoardsAndCards(
      db,
      workspace.id,
      "100%",
    );
    expect(percent.map((r) => r.title)).toEqual(["100% coverage"]);

    const underscore = await workspaceRepo.searchBoardsAndCards(
      db,
      workspace.id,
      "_",
    );
    expect(underscore).toHaveLength(0);
  });
});
