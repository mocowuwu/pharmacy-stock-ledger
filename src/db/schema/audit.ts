import { index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { ts } from "./columns";
import { users } from "./users";

/**
 * Append-only record of every write that is not already a ledger row, plus
 * every authentication event. Never updated, never deleted, never purged --
 * pharmacy records carry multi-year retention requirements, so no "clear old
 * data" feature exists anywhere in this system.
 *
 * `userId` is nullable only because a failed sign-in against an unknown
 * username still has to be recorded.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id),
    /** Username as typed, so failed sign-ins against unknown accounts are legible. */
    actorLabel: text("actor_label"),

    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),

    before: jsonb("before"),
    after: jsonb("after"),

    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_created_idx").on(t.createdAt),
    index("audit_log_user_idx").on(t.userId),
    index("audit_log_action_idx").on(t.action),
    index("audit_log_entity_idx").on(t.entityType, t.entityId),
  ],
);
