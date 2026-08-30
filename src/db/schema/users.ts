import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { locale, userStatus } from "./enums";
import { ts } from "./columns";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    username: text("username").notNull(),
    fullName: text("full_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    status: userStatus("status").notNull().default("active"),

    /**
     * The owner holds every permission implicitly and cannot have any removed.
     * At least one active owner must exist at all times -- enforced in the data
     * access layer, which refuses to suspend or demote the last one.
     */
    isOwner: boolean("is_owner").notNull().default(false),

    /**
     * Set when an account is created or its password is reset. While true, no
     * screen but the change-password screen will load. This is what keeps the
     * audit trail meaningful: the owner issues a temporary password but never
     * knows the working one, so a sale can be attributed to the cashier who
     * rang it.
     */
    mustChangePassword: boolean("must_change_password").notNull().default(true),

    /** Staff-facing UI language. The receipt language is a business setting. */
    locale: locale("locale").notNull().default("id"),

    /**
     * Dispensing of obat keras is the pharmacist's legal responsibility, and
     * the narkotika register names them. Present from the first migration
     * because backfilling professional credentials later is painful.
     */
    isPharmacist: boolean("is_pharmacist").notNull().default(false),
    sipaNumber: text("sipa_number"),
    straNumber: text("stra_number"),

    lastLoginAt: ts("last_login_at"),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: ts("locked_until"),

    /**
     * Null until the in-app tutorial has been started or dismissed once. Drives
     * the one-time "try the tutorial?" prompt; the tutorial itself stays
     * reachable afterwards from the sidebar, so this only ever gates the prompt.
     */
    tutorialSeenAt: ts("tutorial_seen_at"),

    createdBy: uuid("created_by"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // Usernames are compared case-insensitively so "Budi" and "budi" cannot
    // both exist and be mistaken for each other in the audit log.
    uniqueIndex("users_username_lower_idx").on(sql`lower(${t.username})`),
    index("users_status_idx").on(t.status),
  ],
);

/**
 * One row per granted permission. A join table rather than a JSON column, so
 * "who can void sales?" is a query rather than a scan.
 *
 * Owners are not listed here -- they hold everything implicitly.
 */
export const userPermissions = pgTable(
  "user_permissions",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    permission: text("permission").notNull(),
    grantedBy: uuid("granted_by").references(() => users.id),
    grantedAt: ts("granted_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.permission] }),
    index("user_permissions_permission_idx").on(t.permission),
  ],
);

/**
 * Server-side sessions. The cookie carries a random token; only its hash is
 * stored, so a database leak does not hand over live sessions. Being able to
 * list and revoke sessions is a stated requirement -- a stateless JWT could not
 * do it.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: ts("expires_at").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    revokedAt: ts("revoked_at"),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_idx").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId),
    index("sessions_expires_idx").on(t.expiresAt),
  ],
);

export const usersRelations = relations(users, ({ many, one }) => ({
  permissions: many(userPermissions),
  sessions: many(sessions),
  createdByUser: one(users, {
    fields: [users.createdBy],
    references: [users.id],
    relationName: "user_creator",
  }),
}));

export const userPermissionsRelations = relations(userPermissions, ({ one }) => ({
  user: one(users, { fields: [userPermissions.userId], references: [users.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));
