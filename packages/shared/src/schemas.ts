import { z } from "zod";

export const credentialsSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(10).max(128),
});
export const createBoardSchema = z.object({
  name: z.string().trim().min(1).max(100),
});
export const updateBoardSchema = createBoardSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0);
export const createColumnSchema = z.object({
  name: z.string().trim().min(1).max(80),
  order: z.number().finite().optional(),
});
export const updateColumnSchema = z
  .object({ name: z.string().trim().min(1).max(80) })
  .partial()
  .refine((value) => Object.keys(value).length > 0);
export const createCardSchema = z.object({
  title: z.string().trim().min(1).max(180),
  description: z.string().max(4000).optional(),
  columnId: z.string().uuid(),
  order: z.number().finite().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  labels: z.array(z.string().trim().min(1).max(32)).max(12).default([]),
});
export const updateCardSchema = createCardSchema
  .partial()
  .extend({
    labels: z.array(z.string().trim().min(1).max(32)).max(12).optional(),
  })
  .omit({ columnId: true, order: true })
  .refine((value) => Object.keys(value).length > 0);
export const createBoardLabelSchema = z.object({
  name: z.string().trim().min(1).max(32),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
});
export const moveCardSchema = z.object({
  columnId: z.string().uuid(),
  order: z.number().finite(),
});
export const inviteSchema = z.object({
  email: z.string().email().max(254),
  role: z.enum(["editor", "viewer"]),
});
const cardRecordSchema = z.object({
  id: z.string().uuid(),
  columnId: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  order: z.number(),
  assigneeId: z.string().uuid().nullable(),
  dueDate: z.union([z.string().datetime(), z.date()]).nullable(),
  labels: z.array(z.string()),
});
const columnRecordSchema = z.object({
  id: z.string().uuid(),
  boardId: z.string().uuid(),
  name: z.string(),
  order: z.number(),
});
export const boardEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("card.created"),
    card: cardRecordSchema,
  }),
  z.object({
    type: z.literal("card.updated"),
    cardId: z.string().uuid(),
    patch: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal("card.moved"),
    cardId: z.string().uuid(),
    columnId: z.string().uuid(),
    order: z.number(),
  }),
  z.object({ type: z.literal("card.deleted"), cardId: z.string().uuid() }),
  z.object({
    type: z.literal("column.created"),
    column: columnRecordSchema,
  }),
  z.object({
    type: z.literal("column.updated"),
    column: columnRecordSchema,
  }),
  z.object({
    type: z.literal("column.deleted"),
    columnId: z.string().uuid(),
  }),
  z.object({
    type: z.literal("board.updated"),
    board: z.object({ id: z.string().uuid(), name: z.string() }),
  }),
  z.object({ type: z.literal("board.deleted"), boardId: z.string().uuid() }),
  z.object({
    type: z.literal("label.created"),
    label: z.object({
      id: z.string().uuid(),
      boardId: z.string().uuid(),
      name: z.string(),
      color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    }),
  }),
  z.object({
    type: z.literal("presence"),
    userId: z.string().uuid(),
    displayName: z.string().max(100),
  }),
  z.object({
    type: z.literal("presence.snapshot"),
    users: z.array(
      z.object({
        userId: z.string().uuid(),
        displayName: z.string().max(100),
      }),
    ),
  }),
]);

export type Credentials = z.infer<typeof credentialsSchema>;
export type CreateCard = z.infer<typeof createCardSchema>;
export type BoardEvent = z.infer<typeof boardEventSchema>;
