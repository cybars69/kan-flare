import type { SQLiteInsertValue } from "drizzle-orm/sqlite-core";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import {
  cardActivities,
  cardAttachments,
  cards,
  cardsToLabels,
  cardToWorkspaceMembers,
  checklistItems,
  checklists,
  labels,
  lists,
  workspaceMembers,
  workspaces,
} from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

import type { D1BatchItem } from "../utils/d1";
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
    .from(cards)
    .where(isNull(cards.deletedAt));

  return result[0]?.count ?? 0;
};

export const create = async (
  db: dbClient,
  cardInput: {
    title: string;
    description: string | null;
    createdBy: string;
    listId: number;
    workspaceId: number;
    position: "start" | "end";
    dueDate?: Date | null;
  },
) => {
  const publicId = generateUID();
  const atStart = cardInput.position === "start";

  // One atomic batch: make room, take the next card number, insert, log the
  // activity, then renumber the list so positions stay 0..n-1.
  const statements: D1BatchItem[] = [];
  if (atStart) {
    statements.push(
      db.run(sql`
        UPDATE card SET "index" = "index" + 1
        WHERE "listId" = ${cardInput.listId} AND "deletedAt" IS NULL`),
    );
  }
  statements.push(
    db
      .update(workspaces)
      .set({ cardCounter: sql`${workspaces.cardCounter} + 1` })
      .where(eq(workspaces.id, cardInput.workspaceId))
      .returning({ cardCounter: workspaces.cardCounter }),
    db
      .insert(cards)
      .values({
        publicId,
        title: cardInput.title,
        description: cardInput.description,
        createdBy: cardInput.createdBy,
        listId: cardInput.listId,
        index: atStart ? 0 : nextIndex("card", "listId", cardInput.listId),
        cardNumber: sql`(SELECT "cardCounter" FROM workspace WHERE id = ${cardInput.workspaceId})`,
        dueDate: cardInput.dueDate ?? null,
      })
      .returning({
        id: cards.id,
        listId: cards.listId,
        publicId: cards.publicId,
        cardNumber: cards.cardNumber,
      }),
    db.insert(cardActivities).values({
      publicId: generateUID(),
      cardId: sql`(SELECT id FROM card WHERE "publicId" = ${publicId})`,
      type: "card.created",
      createdBy: cardInput.createdBy,
    }),
    db.run(renumberIndexes("card", "listId", idList([cardInput.listId]))),
  );

  const results = await runBatch(db, statements);
  const offset = atStart ? 1 : 0;
  const [counter] = results[offset] as { cardCounter: number }[];
  const [card] = results[offset + 1] as {
    id: number;
    listId: number;
    publicId: string;
    cardNumber: number | null;
  }[];

  if (!counter) throw new Error(`Workspace ${cardInput.workspaceId} not found`);
  if (!card) throw new Error("Unable to create card");

  return card;
};

export const bulkCreateCardLabelRelationships = async (
  db: dbClient,
  cardLabelRelationshipInput: {
    cardId: number;
    labelId: number;
  }[],
) => {
  const results = await runBatch(
    db,
    splitByParameters(cardLabelRelationshipInput, (rows) =>
      db.insert(cardsToLabels).values(rows).returning(),
    ),
  );
  return (results as (typeof cardsToLabels.$inferSelect)[][]).flat();
};

export const bulkCreateCardWorkspaceMemberRelationships = async (
  db: dbClient,
  cardWorkspaceMemberRelationshipInput: {
    cardId: number;
    workspaceMemberId: number;
  }[],
) => {
  const results = await runBatch(
    db,
    splitByParameters(cardWorkspaceMemberRelationshipInput, (rows) =>
      db.insert(cardToWorkspaceMembers).values(rows).returning(),
    ),
  );
  return (results as (typeof cardToWorkspaceMembers.$inferSelect)[][]).flat();
};

export const update = async (
  db: dbClient,
  cardInput: {
    title?: string;
    description?: string | null;
    dueDate?: Date | null;
  },
  args: {
    cardPublicId: string;
  },
) => {
  const [result] = await db
    .update(cards)
    .set({
      title: cardInput.title,
      description: cardInput.description,
      dueDate: cardInput.dueDate !== undefined ? cardInput.dueDate : undefined,
      updatedAt: new Date(),
    })
    .where(and(eq(cards.publicId, args.cardPublicId), isNull(cards.deletedAt)))
    .returning({
      id: cards.id,
      publicId: cards.publicId,
      title: cards.title,
      description: cards.description,
      dueDate: cards.dueDate,
    });

  return result;
};

export const getCardWithListByPublicId = (
  db: dbClient,
  cardPublicId: string,
) => {
  return db.query.cards.findFirst({
    columns: {
      id: true,
      index: true,
    },
    with: {
      list: {
        columns: {
          id: true,
          boardId: true,
        },
      },
    },
    where: and(eq(cards.publicId, cardPublicId), isNull(cards.deletedAt)),
  });
};

export const getByPublicId = (db: dbClient, cardPublicId: string) => {
  return db.query.cards.findFirst({
    columns: {
      id: true,
      publicId: true,
      title: true,
      description: true,
      listId: true,
      dueDate: true,
    },
    with: {
      list: {
        columns: {
          publicId: true,
          name: true,
        },
      },
    },
    where: eq(cards.publicId, cardPublicId),
  });
};

export const getCardLabelRelationship = async (
  db: dbClient,
  args: { cardId: number; labelId: number },
) => {
  return db.query.cardsToLabels.findFirst({
    where: and(
      eq(cardsToLabels.cardId, args.cardId),
      eq(cardsToLabels.labelId, args.labelId),
    ),
  });
};

export const bulkCreate = async (
  db: dbClient,
  cardInput: {
    publicId: string;
    title: string;
    description: string | null;
    createdBy: string;
    listId: number;
    workspaceId: number;
    index: number;
    importId?: number;
  }[],
) => {
  if (cardInput.length === 0) return [];

  // Group incoming cards by list to compute sequential indices per list
  const byList = new Map<number, typeof cardInput>();
  for (const item of cardInput) {
    const arr = byList.get(item.listId) ?? [];
    arr.push(item);
    byList.set(item.listId, arr);
  }

  const values: SQLiteInsertValue<typeof cards>[] = [];
  // Card numbers are counter + n, read from the workspace inside the batch;
  // the counter is bumped after the inserts in the same batch.
  const countsByWorkspace = new Map<number, number>();

  // For each list, append incoming cards after current max index, preserving incoming order
  for (const [listId, items] of byList.entries()) {
    const last = await db.query.cards.findFirst({
      columns: { index: true },
      where: and(eq(cards.listId, listId), isNull(cards.deletedAt)),
      orderBy: [desc(cards.index)],
    });

    let next = last ? last.index + 1 : 0;
    const sorted = [...items].sort((a, b) => a.index - b.index);
    for (const it of sorted) {
      const n = (countsByWorkspace.get(it.workspaceId) ?? 0) + 1;
      countsByWorkspace.set(it.workspaceId, n);
      values.push({
        publicId: it.publicId,
        title: it.title,
        description: it.description,
        createdBy: it.createdBy,
        listId: it.listId,
        index: next++,
        cardNumber: sql`(SELECT "cardCounter" FROM workspace WHERE id = ${it.workspaceId}) + ${n}`,
        importId: it.importId,
      });
    }
  }

  const inserts = splitByParameters(values, (rows) =>
    db.insert(cards).values(rows).returning({ id: cards.id }),
  );
  const results = await runBatch(db, [
    ...inserts,
    ...[...countsByWorkspace.entries()].map(([workspaceId, count]) =>
      db
        .update(workspaces)
        .set({ cardCounter: sql`${workspaces.cardCounter} + ${count}` })
        .where(eq(workspaces.id, workspaceId)),
    ),
    db.run(renumberIndexes("card", "listId", idList([...byList.keys()]))),
  ]);

  return (results.slice(0, inserts.length) as { id: number }[][]).flat();
};

export const createCardLabelRelationship = async (
  db: dbClient,
  cardLabelRelationshipInput: { cardId: number; labelId: number },
) => {
  const [result] = await db
    .insert(cardsToLabels)
    .values({
      cardId: cardLabelRelationshipInput.cardId,
      labelId: cardLabelRelationshipInput.labelId,
    })
    .returning();

  return result;
};

export const bulkCreateCardLabelRelationship = async (
  db: dbClient,
  cardLabelRelationshipInput: { cardId: number; labelId: number }[],
) => {
  const [result] = await bulkCreateCardLabelRelationships(
    db,
    cardLabelRelationshipInput,
  );

  return result;
};

export const getCardMemberRelationship = (
  db: dbClient,
  args: { cardId: number; memberId: number },
) => {
  return db.query.cardToWorkspaceMembers.findFirst({
    where: and(
      eq(cardToWorkspaceMembers.cardId, args.cardId),
      eq(cardToWorkspaceMembers.workspaceMemberId, args.memberId),
    ),
  });
};

export const createCardMemberRelationship = async (
  db: dbClient,
  cardMemberRelationshipInput: { cardId: number; memberId: number },
) => {
  const [result] = await db
    .insert(cardToWorkspaceMembers)
    .values({
      cardId: cardMemberRelationshipInput.cardId,
      workspaceMemberId: cardMemberRelationshipInput.memberId,
    })
    .returning();

  return { success: !!result };
};

export const getWithListAndMembersByPublicId = async (
  db: dbClient,
  cardPublicId: string,
) => {
  const card = await db.query.cards.findFirst({
    columns: {
      id: true,
      publicId: true,
      title: true,
      description: true,
      dueDate: true,
      createdBy: true,
      cardNumber: true,
      index: true,
    },
    with: {
      labels: {
        with: {
          label: {
            columns: {
              publicId: true,
              name: true,
              colourCode: true,
            },
          },
        },
      },
      attachments: {
        columns: {
          publicId: true,
          contentType: true,
          s3Key: true,
          originalFilename: true,
          size: true,
        },
        where: isNull(cardAttachments.deletedAt),
        orderBy: asc(cardAttachments.createdAt),
      },
      checklists: {
        columns: {
          publicId: true,
          name: true,
          index: true,
        },
        where: isNull(checklists.deletedAt),
        orderBy: asc(checklists.index),
        with: {
          items: {
            columns: {
              publicId: true,
              title: true,
              completed: true,
              index: true,
            },
            where: isNull(checklistItems.deletedAt),
            orderBy: asc(checklistItems.index),
          },
        },
      },
      list: {
        columns: {
          publicId: true,
          name: true,
        },
        with: {
          board: {
            columns: {
              publicId: true,
              name: true,
            },
            with: {
              labels: {
                columns: {
                  publicId: true,
                  colourCode: true,
                  name: true,
                },
                where: isNull(labels.deletedAt),
              },
              lists: {
                columns: {
                  publicId: true,
                  name: true,
                },
                where: isNull(lists.deletedAt),
                orderBy: asc(lists.index),
              },
              workspace: {
                columns: {
                  publicId: true,
                  cardPrefix: true,
                },
                with: {
                  members: {
                    columns: {
                      publicId: true,
                      email: true,
                      status: true,
                    },
                    with: {
                      user: {
                        columns: {
                          id: true,
                          name: true,
                          email: true,
                          image: true,
                        },
                      },
                    },
                    where: isNull(workspaceMembers.deletedAt),
                  },
                },
              },
            },
          },
        },
        // https://github.com/drizzle-team/drizzle-orm/issues/2903
        // where: isNull(lists.deletedAt),
      },
      members: {
        with: {
          member: {
            columns: {
              publicId: true,
              email: true,
            },
            with: {
              user: {
                columns: {
                  id: true,
                  name: true,
                },
              },
            },
            // https://github.com/drizzle-team/drizzle-orm/issues/2903
            // where: isNull(workspaceMembers.deletedAt),
          },
        },
      },
      activities: {
        columns: {
          publicId: true,
          type: true,
          createdAt: true,
          fromIndex: true,
          toIndex: true,
          fromTitle: true,
          toTitle: true,
          fromDescription: true,
          toDescription: true,
          fromDueDate: true,
          toDueDate: true,
        },
        with: {
          fromList: {
            columns: {
              publicId: true,
              name: true,
              index: true,
            },
          },
          toList: {
            columns: {
              publicId: true,
              name: true,
              index: true,
            },
          },
          label: {
            columns: {
              publicId: true,
              name: true,
            },
          },
          member: {
            columns: {
              publicId: true,
            },
            with: {
              user: {
                columns: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
          user: {
            columns: {
              id: true,
              name: true,
              email: true,
            },
          },
          comment: {
            columns: {
              publicId: true,
              comment: true,
              createdBy: true,
              updatedAt: true,
              deletedAt: true,
            },
            // https://github.com/drizzle-team/drizzle-orm/issues/2903
            // where: isNull(comments.deletedAt),
          },
        },
      },
    },
    where: and(eq(cards.publicId, cardPublicId), isNull(cards.deletedAt)),
  });

  if (!card) return null;

  const formattedResult = {
    ...card,
    labels: card.labels.map((label) => label.label),
    members: card.members.map((member) => member.member),
    activities: card.activities.filter(
      (activity) => !activity.comment?.deletedAt,
    ),
  };

  return formattedResult;
};

export const reorder = async (
  db: dbClient,
  args: {
    newListId: number | undefined;
    newIndex: number | undefined;
    cardId: number;
  },
) => {
  const card = await db.query.cards.findFirst({
    columns: {
      id: true,
      index: true,
    },
    where: and(eq(cards.id, args.cardId), isNull(cards.deletedAt)),
    with: {
      list: {
        columns: {
          id: true,
          index: true,
        },
      },
    },
  });

  if (!card?.list)
    throw new Error(`Card not found for public ID ${args.cardId}`);

  const currentList = card.list;
  const currentIndex = card.index;
  let newList:
    | { id: number; index: number; cards: { id: number; index: number }[] }
    | undefined;

  if (args.newListId) {
    newList = await db.query.lists.findFirst({
      columns: {
        id: true,
        index: true,
      },
      with: {
        cards: {
          columns: {
            id: true,
            index: true,
          },
          where: isNull(cards.deletedAt),
          orderBy: desc(cards.index),
          limit: 1,
        },
      },
      where: and(eq(lists.id, args.newListId), isNull(lists.deletedAt)),
    });

    if (!newList)
      throw new Error(`List not found for public ID ${args.newListId}`);
  }

  let newIndex = args.newIndex;

  if (newIndex === undefined) {
    const lastCardIndex = newList?.cards.length
      ? newList.cards[0]?.index
      : undefined;

    newIndex = lastCardIndex !== undefined ? lastCardIndex + 1 : 0;
  }

  // Moves run as one batch that ends by renumbering the affected lists, so
  // positions stay 0..n-1 even if another write landed after our reads.
  const statements: D1BatchItem[] = [];
  const affectedListIds = [currentList.id];

  if (!newList || currentList.id === newList.id) {
    statements.push(
      db.run(sql`
        UPDATE card
        SET "index" =
          CASE
            WHEN id = ${card.id} THEN ${newIndex}
            WHEN ${currentIndex} < ${newIndex} AND "index" > ${currentIndex} AND "index" <= ${newIndex} THEN "index" - 1
            WHEN ${currentIndex} > ${newIndex} AND "index" >= ${newIndex} AND "index" < ${currentIndex} THEN "index" + 1
            ELSE "index"
          END
        WHERE "listId" = ${currentList.id} AND "deletedAt" IS NULL`),
    );
  } else {
    affectedListIds.push(newList.id);
    statements.push(
      db.run(sql`
        UPDATE card
        SET "index" = "index" + 1
        WHERE "listId" = ${newList.id} AND "index" >= ${newIndex} AND "deletedAt" IS NULL`),
      db.run(sql`
        UPDATE card
        SET "index" = "index" - 1
        WHERE "listId" = ${currentList.id} AND "index" > ${currentIndex} AND "deletedAt" IS NULL`),
      db.run(sql`
        UPDATE card
        SET "listId" = ${newList.id}, "index" = ${newIndex}
        WHERE id = ${card.id} AND "deletedAt" IS NULL`),
    );
  }

  statements.push(
    db.run(renumberIndexes("card", "listId", idList(affectedListIds))),
    db.query.cards.findFirst({
      columns: {
        id: true,
        publicId: true,
        title: true,
        description: true,
        dueDate: true,
      },
      where: eq(cards.id, card.id),
    }),
  );

  const results = await runBatch(db, statements);
  return results[results.length - 1] as
    | {
        id: number;
        publicId: string;
        title: string;
        description: string | null;
        dueDate: Date | null;
      }
    | undefined;
};

export const softDelete = async (
  db: dbClient,
  args: {
    cardId: number;
    deletedAt: Date;
    deletedBy: string;
  },
) => {
  const [deleted] = await runBatch(db, [
    db
      .update(cards)
      .set({ deletedAt: args.deletedAt, deletedBy: args.deletedBy })
      .where(eq(cards.id, args.cardId))
      .returning({
        id: cards.id,
        listId: cards.listId,
        index: cards.index,
      }),
    db.run(
      renumberIndexes(
        "card",
        "listId",
        sql`(SELECT "listId" FROM card WHERE id = ${args.cardId})`,
      ),
    ),
  ]);

  const [result] = deleted as { id: number; listId: number; index: number }[];
  if (!result) throw new Error(`Unable to soft delete card ID ${args.cardId}`);

  return result;
};

export const softDeleteAllByListIds = async (
  db: dbClient,
  args: {
    listIds: number[];
    deletedAt: Date;
    deletedBy: string;
  },
) => {
  const updatedCards = await db
    .update(cards)
    .set({ deletedAt: args.deletedAt, deletedBy: args.deletedBy })
    .where(and(inArray(cards.listId, args.listIds), isNull(cards.deletedAt)))
    .returning({
      id: cards.id,
    });

  return updatedCards;
};

export const hardDeleteCardMemberRelationship = async (
  db: dbClient,
  args: { cardId: number; memberId: number },
) => {
  const [result] = await db
    .delete(cardToWorkspaceMembers)
    .where(
      and(
        eq(cardToWorkspaceMembers.cardId, args.cardId),
        eq(cardToWorkspaceMembers.workspaceMemberId, args.memberId),
      ),
    )
    .returning();

  return { success: !!result };
};

export const hardDeleteCardLabelRelationship = async (
  db: dbClient,
  args: { cardId: number; labelId: number },
) => {
  const [result] = await db
    .delete(cardsToLabels)
    .where(
      and(
        eq(cardsToLabels.cardId, args.cardId),
        eq(cardsToLabels.labelId, args.labelId),
      ),
    )
    .returning();

  return result;
};

export const hardDeleteAllCardLabelRelationships = async (
  db: dbClient,
  labelId: number,
) => {
  const [result] = await db
    .delete(cardsToLabels)
    .where(eq(cardsToLabels.labelId, labelId))
    .returning();

  return result;
};

export const getWorkspaceAndCardIdByCardPublicId = async (
  db: dbClient,
  cardPublicId: string,
) => {
  const result = await db.query.cards.findFirst({
    columns: { id: true, createdBy: true },
    where: and(eq(cards.publicId, cardPublicId), isNull(cards.deletedAt)),
    with: {
      list: {
        columns: { name: true, publicId: true },
        with: {
          board: {
            columns: {
              publicId: true,
              workspaceId: true,
              visibility: true,
              name: true,
            },
          },
        },
      },
    },
  });

  return result
    ? {
        id: result.id,
        createdBy: result.createdBy,
        workspaceId: result.list.board.workspaceId,
        workspaceVisibility: result.list.board.visibility,
        listPublicId: result.list.publicId,
        listName: result.list.name,
        boardPublicId: result.list.board.publicId,
        boardName: result.list.board.name,
      }
    : null;
};
