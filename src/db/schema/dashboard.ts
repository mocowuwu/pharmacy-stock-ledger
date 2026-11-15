import { jsonb, pgTable, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";
import { ts } from "./columns";

/**
 * Each account's own Beranda: which widgets it shows, and in what order.
 *
 * One row per account, written only by the owner. `widgets` is an ordered list
 * of widget keys (`src/lib/dashboard/widgets.ts`); **null means "the default
 * layout"**, so resetting an account clears the list rather than deleting the
 * row, and an account the owner has never touched has no row at all.
 *
 * A layout chooses what is shown; it never grants anything. A widget the
 * account has no permission for is dropped at render time and its data is never
 * fetched, so listing one here cannot widen what an account can see.
 */
export const dashboardLayouts = pgTable("dashboard_layouts", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id),
  widgets: jsonb("widgets").$type<string[] | null>(),
  updatedBy: uuid("updated_by")
    .notNull()
    .references(() => users.id),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
