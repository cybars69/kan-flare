import type { SQLiteInsertValue } from "drizzle-orm/sqlite-core";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import type { BoardVisibilityStatus } from "@kan/db/schema";
import {
  boards,
  cardActivities,
  cardAttachments,
  cards,
  cardsToLabels,
  cardToWorkspaceMembers,
  checklistItems,
  checklists,
  comments,
  labels,
  lists,
  userBoardFavorites,
  workspaceMembers,
} from "@kan/db/schema";
import { generateUID, normalizeDescription } from "@kan/shared/utils";

import { runBatch, splitByParameters } from "../utils/d1";

export const getCount = async (db: dbClient) => {
  const result = await db
    .select({ count: count() })
    .from(boards)
    .where(isNull(boards.deletedAt));

  return result[0]?.count ?? 0;
};

export const getAllByWorkspaceId = async (
  db: dbClient,
  workspaceId: number,
  userId: string,
  opts?: { type?: "regular" | "template"; archived?: boolean },
) => {
  const boardsData = await db.query.boards.findMany({
    columns: {
      publicId: true,
      name: true,
    },
    with: {
      userFavorites: {
        where: eq(userBoardFavorites.userId, userId),
        columns: {
          userId: true,
        },
      },
      lists: {
        columns: {
          publicId: true,
          name: true,
          index: true,
        },
        orderBy: [asc(lists.index)],
      },
      labels: {
        columns: {
          publicId: true,
          name: true,
          colourCode: true,
        },
      },
    },
    where: and(
      eq(boards.workspaceId, workspaceId),
      isNull(boards.deletedAt),
      opts?.type ? eq(boards.type, opts.type) : undefined,
      opts?.archived !== undefined
        ? eq(boards.isArchived, opts.archived)
        : undefined,
    ),
  });

  // Transform and sort: favorites first, then alphabetically
  return boardsData
    .map((board) => ({
      ...board,
      favorite: board.userFavorites.length > 0,
      userFavorites: undefined,
    }))
    .sort((a, b) => {
      // Sort favorites first
      if (a.favorite && !b.favorite) return -1;
      if (!a.favorite && b.favorite) return 1;
      // Then alphabetically by name
      return a.name.localeCompare(b.name);
    });
};

export const getIdByPublicId = async (db: dbClient, boardPublicId: string) => {
  const board = await db.query.boards.findFirst({
    columns: {
      id: true,
      type: true,
      isArchived: true,
    },
    where: eq(boards.publicId, boardPublicId),
  });

  return board;
};

interface DueDateFilter {
  startDate?: Date;
  endDate?: Date;
  hasNoDueDate?: boolean;
}

const buildDueDateWhere = (filters: DueDateFilter[]) => {
  if (!filters.length) return undefined;

  const clauses = filters
    .map((filter) => {
      const conditions: ReturnType<typeof and>[] = [];

      if (filter.hasNoDueDate) {
        conditions.push(isNull(cards.dueDate));
      } else {
        conditions.push(isNotNull(cards.dueDate));

        if (filter.startDate)
          conditions.push(gte(cards.dueDate, filter.startDate));

        if (filter.endDate) conditions.push(lt(cards.dueDate, filter.endDate));
      }

      return conditions.length > 0 ? and(...conditions) : undefined;
    })
    .filter((clause): clause is NonNullable<typeof clause> => !!clause);

  if (!clauses.length) return undefined;

  return or(...clauses);
};

export const getByPublicId = async (
  db: dbClient,
  boardPublicId: string,
  userId: string,
  filters: {
    members: string[];
    labels: string[];
    lists: string[];
    dueDate: DueDateFilter[];
    type: "regular" | "template" | undefined;
  },
) => {
  // A subquery rather than a list of ids: a list could pass D1's
  // 100-parameter limit on boards with many matching cards.
  const filteredCardIds =
    filters.labels.length > 0 || filters.members.length > 0
      ? db
          .select({
            publicId: cards.publicId,
          })
          .from(cards)
          .leftJoin(cardsToLabels, eq(cards.id, cardsToLabels.cardId))
          .leftJoin(labels, eq(cardsToLabels.labelId, labels.id))
          .leftJoin(
            cardToWorkspaceMembers,
            eq(cards.id, cardToWorkspaceMembers.cardId),
          )
          .leftJoin(
            workspaceMembers,
            eq(cardToWorkspaceMembers.workspaceMemberId, workspaceMembers.id),
          )
          .where(
            and(
              isNull(cards.deletedAt),
              or(
                filters.labels.length > 0
                  ? inArray(labels.publicId, filters.labels)
                  : undefined,
                filters.members.length > 0
                  ? inArray(workspaceMembers.publicId, filters.members)
                  : undefined,
              ),
            ),
          )
      : undefined;

  const board = await db.query.boards.findFirst({
    columns: {
      publicId: true,
      name: true,
      slug: true,
      visibility: true,
      isArchived: true,
    },
    with: {
      userFavorites: {
        where: eq(userBoardFavorites.userId, userId),
        columns: {
          userId: true,
        },
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
      labels: {
        columns: {
          publicId: true,
          name: true,
          colourCode: true,
        },
        where: isNull(labels.deletedAt),
      },
      lists: {
        columns: {
          publicId: true,
          name: true,
          boardId: true,
          index: true,
        },
        with: {
          cards: {
            columns: {
              publicId: true,
              title: true,
              description: true,
              listId: true,
              index: true,
              dueDate: true,
              cardNumber: true,
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
              members: {
                with: {
                  member: {
                    columns: {
                      publicId: true,
                      email: true,
                      deletedAt: true,
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
                  },
                },
              },
              attachments: {
                columns: {
                  publicId: true,
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
              comments: {
                columns: {
                  publicId: true,
                },
                where: isNull(comments.deletedAt),
                limit: 1,
              },
            },
            where: and(
              filteredCardIds
                ? inArray(cards.publicId, filteredCardIds)
                : undefined,
              isNull(cards.deletedAt),
              buildDueDateWhere(filters.dueDate),
            ),
            orderBy: [asc(cards.index)],
          },
        },
        where: and(
          isNull(lists.deletedAt),
          filters.lists.length > 0
            ? inArray(lists.publicId, filters.lists)
            : undefined,
        ),
        orderBy: [asc(lists.index)],
      },
      allLists: {
        columns: {
          publicId: true,
          name: true,
        },
        where: isNull(lists.deletedAt),
        orderBy: [asc(lists.index)],
      },
    },
    where: and(
      eq(boards.publicId, boardPublicId),
      isNull(boards.deletedAt),
      eq(boards.type, filters.type ?? "regular"),
    ),
  });

  if (!board) return null;

  const formattedResult = {
    ...board,
    favorite: board.userFavorites.length > 0,
    userFavorites: undefined,
    lists: board.lists.map((list) => ({
      ...list,
      cards: list.cards.map((card) => ({
        ...card,
        labels: card.labels.map((label) => label.label),
        members: card.members
          .map((member) => member.member)
          .filter((member) => member.deletedAt === null),
      })),
    })),
  };

  return formattedResult;
};

export const getBySlug = async (
  db: dbClient,
  boardSlug: string,
  workspaceId: number,
  filters: {
    members: string[];
    labels: string[];
    lists: string[];
    dueDate: DueDateFilter[];
  },
) => {
  // A subquery rather than a list of ids: a list could pass D1's
  // 100-parameter limit on boards with many matching cards.
  const filteredCardIds = filters.labels.length
    ? db
        .select({
          publicId: cards.publicId,
        })
        .from(cards)
        .leftJoin(cardsToLabels, eq(cards.id, cardsToLabels.cardId))
        .leftJoin(labels, eq(cardsToLabels.labelId, labels.id))
        .where(
          and(
            isNull(cards.deletedAt),
            filters.labels.length > 0
              ? inArray(labels.publicId, filters.labels)
              : undefined,
          ),
        )
    : undefined;

  const board = await db.query.boards.findFirst({
    columns: {
      publicId: true,
      name: true,
      slug: true,
      visibility: true,
    },
    with: {
      workspace: {
        columns: {
          publicId: true,
          name: true,
          slug: true,
          cardPrefix: true,
        },
      },
      labels: {
        columns: {
          publicId: true,
          name: true,
          colourCode: true,
        },
        where: isNull(labels.deletedAt),
      },
      lists: {
        columns: {
          publicId: true,
          name: true,
          boardId: true,
          index: true,
        },
        with: {
          cards: {
            columns: {
              publicId: true,
              title: true,
              description: true,
              listId: true,
              index: true,
              dueDate: true,
              cardNumber: true,
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
                },
                where: isNull(cardAttachments.deletedAt),
                orderBy: asc(cardAttachments.createdAt),
              },
              comments: {
                columns: {
                  publicId: true,
                },
                where: isNull(comments.deletedAt),
                limit: 1,
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
            },
            where: and(
              filteredCardIds
                ? inArray(cards.publicId, filteredCardIds)
                : undefined,
              isNull(cards.deletedAt),
              buildDueDateWhere(filters.dueDate),
            ),
            orderBy: [asc(cards.index)],
          },
        },
        where: and(
          isNull(lists.deletedAt),
          filters.lists.length > 0
            ? inArray(lists.publicId, filters.lists)
            : undefined,
        ),
        orderBy: [asc(lists.index)],
      },
      allLists: {
        columns: {
          publicId: true,
          name: true,
        },
        where: isNull(lists.deletedAt),
        orderBy: [asc(lists.index)],
      },
    },
    where: and(
      eq(boards.slug, boardSlug),
      eq(boards.workspaceId, workspaceId),
      isNull(boards.deletedAt),
      eq(boards.visibility, "public"),
    ),
  });

  if (!board) return null;

  const formattedResult = {
    ...board,
    lists: board.lists.map((list) => ({
      ...list,
      cards: list.cards.map((card) => ({
        ...card,
        labels: card.labels.map((label) => label.label),
      })),
    })),
  };

  return formattedResult;
};

export const getWithListIdsByPublicId = (
  db: dbClient,
  boardPublicId: string,
) => {
  return db.query.boards.findFirst({
    columns: {
      id: true,
      workspaceId: true,
      createdBy: true,
    },
    with: {
      lists: {
        columns: {
          id: true,
        },
      },
    },
    where: eq(boards.publicId, boardPublicId),
  });
};

export const getWithLatestListIndexByPublicId = (
  db: dbClient,
  boardPublicId: string,
) => {
  return db.query.boards.findFirst({
    columns: {
      id: true,
      workspaceId: true,
    },
    with: {
      lists: {
        columns: {
          index: true,
        },
        where: isNull(lists.deletedAt),
        orderBy: [desc(lists.index)],
        limit: 1,
      },
    },
    where: eq(boards.publicId, boardPublicId),
  });
};

export const create = async (
  db: dbClient,
  boardInput: {
    publicId?: string;
    name: string;
    createdBy: string;
    workspaceId: number;
    importId?: number;
    slug: string;
    type?: "regular" | "template";
    sourceBoardId?: number;
  },
) => {
  const [result] = await db
    .insert(boards)
    .values({
      publicId: boardInput.publicId ?? generateUID(),
      name: boardInput.name,
      createdBy: boardInput.createdBy,
      workspaceId: boardInput.workspaceId,
      importId: boardInput.importId,
      slug: boardInput.slug,
      type: boardInput.type ?? "regular",
      sourceBoardId: boardInput.sourceBoardId,
    })
    .returning({
      id: boards.id,
      publicId: boards.publicId,
      name: boards.name,
    });

  return result;
};

export const update = async (
  db: dbClient,
  boardInput: {
    name: string | undefined;
    slug: string | undefined;
    visibility: BoardVisibilityStatus | undefined;
    boardPublicId: string;
    isArchived?: boolean;
  },
) => {
  const [result] = await db
    .update(boards)
    .set({
      name: boardInput.name,
      slug: boardInput.slug,
      visibility: boardInput.visibility,
      updatedAt: new Date(),
      ...(boardInput.isArchived !== undefined && {
        isArchived: boardInput.isArchived,
      }),
    })
    .where(eq(boards.publicId, boardInput.boardPublicId))
    .returning({
      publicId: boards.publicId,
      name: boards.name,
    });

  return result;
};

export const softDelete = async (
  db: dbClient,
  args: {
    boardId: number;
    deletedAt: Date;
    deletedBy: string;
  },
) => {
  const [result] = await db
    .update(boards)
    .set({ deletedAt: args.deletedAt, deletedBy: args.deletedBy })
    .where(and(eq(boards.id, args.boardId), isNull(boards.deletedAt)))
    .returning({
      publicId: boards.publicId,
      name: boards.name,
    });

  return result;
};

export const hardDelete = async (db: dbClient, workspaceId: number) => {
  const [result] = await db
    .delete(boards)
    .where(eq(boards.workspaceId, workspaceId))
    .returning({
      publicId: boards.publicId,
      name: boards.name,
    });

  return result;
};

export const isSlugUnique = async (
  db: dbClient,
  args: { slug: string; workspaceId: number },
) => {
  const result = await db.query.boards.findFirst({
    columns: {
      slug: true,
    },
    where: and(
      eq(boards.slug, args.slug),
      eq(boards.workspaceId, args.workspaceId),
      isNull(boards.deletedAt),
    ),
  });

  return result === undefined;
};

export const getWorkspaceAndBoardIdByBoardPublicId = async (
  db: dbClient,
  boardPublicId: string,
) => {
  const result = await db.query.boards.findFirst({
    columns: {
      id: true,
      workspaceId: true,
      createdBy: true,
    },
    where: eq(boards.publicId, boardPublicId),
  });

  return result;
};

/**
 * Fetches the board fields needed by the move mutation:
 * identity, naming, type guards, and workspace ownership.
 * Soft-deleted boards are excluded — moving a tombstoned board has
 * no defensible semantics.
 */
export const getBoardForMove = async (db: dbClient, boardPublicId: string) => {
  return db.query.boards.findFirst({
    columns: {
      id: true,
      name: true,
      slug: true,
      type: true,
      isArchived: true,
      workspaceId: true,
      createdBy: true,
    },
    where: and(eq(boards.publicId, boardPublicId), isNull(boards.deletedAt)),
  });
};

export const isBoardSlugAvailable = async (
  db: dbClient,
  boardSlug: string,
  workspaceId: number,
) => {
  const result = await db.query.boards.findFirst({
    columns: {
      id: true,
    },
    where: and(
      eq(boards.slug, boardSlug),
      eq(boards.workspaceId, workspaceId),
      isNull(boards.deletedAt),
    ),
  });

  return result === undefined;
};

// Create a new board (regular/template) from a full board snapshot
export const createFromSnapshot = async (
  db: dbClient,
  args: {
    source: {
      name: string;
      labels: { publicId: string; name: string; colourCode: string | null }[];
      lists: {
        name: string;
        index: number;
        cards: {
          title: string;
          description: string | null;
          index: number;
          labels: {
            publicId: string;
            name: string;
            colourCode: string | null;
          }[];
          checklists?: {
            publicId: string;
            name: string;
            index: number;
            items: {
              publicId: string;
              title: string;
              completed: boolean;
              index: number;
            }[];
          }[];
        }[];
      }[];
    };
    workspaceId: number;
    createdBy: string;
    slug: string;
    name?: string;
    type: "regular" | "template";
    sourceBoardId?: number;
  },
) => {
  // Everything is written in one atomic D1 batch. Rows reference their
  // parents through `publicId` subqueries, since database ids are not known
  // until the batch runs.
  const idOf = (
    table: "board" | "label" | "list" | "card" | "card_checklist",
    publicId: string,
  ) =>
    sql`(SELECT id FROM ${sql.identifier(table)} WHERE "publicId" = ${publicId})`;

  const boardPublicId = generateUID();

  const labelPublicIds = new Map<string, string>();
  const labelRows: SQLiteInsertValue<typeof labels>[] = args.source.labels.map(
    (l) => {
      const publicId = generateUID();
      labelPublicIds.set(l.publicId, publicId);
      return {
        publicId,
        name: l.name,
        colourCode: l.colourCode ?? null,
        createdBy: args.createdBy,
        boardId: idOf("board", boardPublicId),
      };
    },
  );

  const listRows: SQLiteInsertValue<typeof lists>[] = [];
  const cardRows: SQLiteInsertValue<typeof cards>[] = [];
  const cardLabelRows: SQLiteInsertValue<typeof cardsToLabels>[] = [];
  const checklistRows: SQLiteInsertValue<typeof checklists>[] = [];
  const itemRows: SQLiteInsertValue<typeof checklistItems>[] = [];
  const activityRows: SQLiteInsertValue<typeof cardActivities>[] = [];

  const srcLists = [...args.source.lists].sort((a, b) => a.index - b.index);
  for (const list of srcLists) {
    const listPublicId = generateUID();
    listRows.push({
      publicId: listPublicId,
      name: list.name,
      createdBy: args.createdBy,
      boardId: idOf("board", boardPublicId),
      index: list.index,
    });

    const sortedCards = [...list.cards].sort((a, b) => a.index - b.index);
    for (const card of sortedCards) {
      const cardPublicId = generateUID();
      const cardId = idOf("card", cardPublicId);
      cardRows.push({
        publicId: cardPublicId,
        title: card.title,
        description: normalizeDescription(card.description),
        createdBy: args.createdBy,
        listId: idOf("list", listPublicId),
        index: card.index,
      });
      activityRows.push({
        publicId: generateUID(),
        type: "card.created",
        cardId,
        createdBy: args.createdBy,
        sourceBoardId: args.sourceBoardId,
      });

      for (const label of card.labels) {
        const newLabelPublicId = labelPublicIds.get(label.publicId);
        if (!newLabelPublicId) continue;
        const labelId = idOf("label", newLabelPublicId);
        cardLabelRows.push({ cardId, labelId });
        activityRows.push({
          publicId: generateUID(),
          type: "card.updated.label.added",
          cardId,
          labelId,
          createdBy: args.createdBy,
          sourceBoardId: args.sourceBoardId,
        });
      }

      const sortedChecklists = [...(card.checklists ?? [])].sort(
        (a, b) => a.index - b.index,
      );
      for (const checklist of sortedChecklists) {
        const checklistPublicId = generateUID();
        checklistRows.push({
          publicId: checklistPublicId,
          name: checklist.name,
          createdBy: args.createdBy,
          cardId,
          index: checklist.index,
        });
        activityRows.push({
          publicId: generateUID(),
          type: "card.updated.checklist.added",
          cardId,
          toTitle: checklist.name,
          createdBy: args.createdBy,
          sourceBoardId: args.sourceBoardId,
        });

        const sortedItems = [...checklist.items].sort(
          (a, b) => a.index - b.index,
        );
        for (const item of sortedItems) {
          itemRows.push({
            publicId: generateUID(),
            title: item.title,
            createdBy: args.createdBy,
            checklistId: idOf("card_checklist", checklistPublicId),
            index: item.index,
            completed: !!item.completed,
          });
          activityRows.push({
            publicId: generateUID(),
            type: "card.updated.checklist.item.added",
            cardId,
            toTitle: item.title,
            createdBy: args.createdBy,
            sourceBoardId: args.sourceBoardId,
          });
        }
      }
    }
  }

  const [insertedBoards] = await runBatch(db, [
    db
      .insert(boards)
      .values({
        publicId: boardPublicId,
        name: args.name ?? args.source.name,
        slug: args.slug,
        createdBy: args.createdBy,
        workspaceId: args.workspaceId,
        type: args.type,
        sourceBoardId: args.sourceBoardId,
      })
      .returning({
        id: boards.id,
        publicId: boards.publicId,
        name: boards.name,
      }),
    ...splitByParameters(labelRows, (rows) => db.insert(labels).values(rows)),
    ...splitByParameters(listRows, (rows) => db.insert(lists).values(rows)),
    ...splitByParameters(cardRows, (rows) => db.insert(cards).values(rows)),
    ...splitByParameters(cardLabelRows, (rows) =>
      db.insert(cardsToLabels).values(rows),
    ),
    ...splitByParameters(checklistRows, (rows) =>
      db.insert(checklists).values(rows),
    ),
    ...splitByParameters(itemRows, (rows) =>
      db.insert(checklistItems).values(rows),
    ),
    ...splitByParameters(activityRows, (rows) =>
      db.insert(cardActivities).values(rows),
    ),
  ]);

  const [newBoard] = insertedBoards as {
    id: number;
    publicId: string;
    name: string;
  }[];
  if (!newBoard) throw new Error("Failed to create board");

  return newBoard;
};

export const moveToWorkspace = async (
  db: dbClient,
  boardId: number,
  targetWorkspaceId: number,
  newSlug?: string,
) => {
  const [moved] = await runBatch(db, [
    // Update the board's workspace (and slug if provided)
    db
      .update(boards)
      .set({
        workspaceId: targetWorkspaceId,
        ...(newSlug && { slug: newSlug }),
        updatedAt: new Date(),
      })
      .where(eq(boards.id, boardId))
      .returning({
        publicId: boards.publicId,
        name: boards.name,
      }),
    // Clear card member assignments on every card ever belonging to this
    // board, including soft-deleted cards under soft-deleted lists. Member
    // assignments point at workspace-scoped members that no longer exist after
    // the move; if we leave assignments on soft-deleted cards, a later restore
    // would resurrect rogue references to the old workspace.
    db.delete(cardToWorkspaceMembers).where(
      inArray(
        cardToWorkspaceMembers.cardId,
        db
          .select({ id: cards.id })
          .from(cards)
          .where(
            inArray(
              cards.listId,
              db
                .select({ id: lists.id })
                .from(lists)
                .where(eq(lists.boardId, boardId)),
            ),
          ),
      ),
    ),
  ]);

  const [updatedBoard] = moved as { publicId: string; name: string }[];
  if (!updatedBoard) throw new Error("Failed to move board");

  return updatedBoard;
};

export const addUserFavorite = async (
  db: dbClient,
  userId: string,
  boardId: number,
) => {
  return db
    .insert(userBoardFavorites)
    .values({
      userId,
      boardId,
    })
    .onConflictDoNothing()
    .returning();
};

export const removeUserFavorite = async (
  db: dbClient,
  userId: string,
  boardId: number,
) => {
  return db
    .delete(userBoardFavorites)
    .where(
      and(
        eq(userBoardFavorites.userId, userId),
        eq(userBoardFavorites.boardId, boardId),
      ),
    )
    .returning();
};
