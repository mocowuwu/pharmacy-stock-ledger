import "server-only";

import { getDb } from "@/db";
import { recordAudit } from "@/lib/audit";
import { can } from "@/lib/auth/permissions";
import {
  applyCostVisibility,
  decidePanelEntry as decideEntry,
  listPanelRows,
  panelPendingCount,
  panelTaxChoices,
  panelTotals,
  parsePanelInput,
  pharmacistChoices,
  recordPanelEntry,
  searchPanelItems,
  voidPanelEntry as voidEntry,
  type PanelRange,
  type RawPanelInput,
} from "@/lib/panel/entries";
import { assertPermission } from "./session";
import { getSettings } from "./settings";

export { PanelError } from "@/lib/panel/entries";

/**
 * Records an entry for a panel order. Writes no stock movement: see
 * `src/lib/panel/entries.ts`.
 *
 * The audit row goes in the same transaction as the entry, so the record cannot
 * exist without the log of who made it, or the reverse.
 */
export async function createPanelEntry(raw: RawPanelInput) {
  const session = await assertPermission("panel.create");
  // Reading the settings is what makes the owner's timezone the process's, and
  // "today" -- the latest date an entry may carry -- is read from it.
  await getSettings();
  const input = parsePanelInput(raw);
  const db = await getDb();

  return db.transaction(async (tx) => {
    const executor = tx as unknown as typeof db;
    const created = await recordPanelEntry(executor, {
      ...input,
      actorId: session.user.id,
      // The owner has nobody above them, so an order of theirs is never held for
      // approval; everyone else's is, when the pharmacy asks for it.
      actorIsOwner: session.user.isOwner,
      // The operator is the answerable pharmacist when they are one and nobody
      // else was named, as at the disposal screen.
      pharmacistId:
        input.pharmacistId ?? (session.user.isPharmacist ? session.user.id : null),
    });

    await recordAudit(
      {
        userId: session.user.id,
        actorLabel: session.user.username,
        action: "panel.entry_created",
        entityType: "panel_entries",
        entityId: created.id,
        after: {
          entryNumber: created.entryNumber,
          entryDate: created.entryDate,
          orderRef: created.orderRef,
          itemCode: created.itemCode,
          qty: created.qty,
          unitCost: created.unitCost,
          unitPrice: created.unitPrice,
          taxMode: created.taxMode,
          taxRateBps: created.taxRateBps,
          taxAmount: created.taxAmount,
          status: created.status,
          partnerName: created.partnerName,
          destination: created.destination,
        },
      },
      executor,
    );
    return created;
  });
}

/** Voids an entry with a reason. The row stays; it just stops counting. */
export async function voidPanelEntry(entryId: string, reason: string) {
  const session = await assertPermission("panel.void");
  await getSettings();
  const db = await getDb();

  return db.transaction(async (tx) => {
    const executor = tx as unknown as typeof db;
    const voided = await voidEntry(executor, { entryId, reason, actorId: session.user.id });
    await recordAudit(
      {
        userId: session.user.id,
        actorLabel: session.user.username,
        action: "panel.entry_voided",
        entityType: "panel_entries",
        entityId: voided.id,
        after: { entryNumber: voided.entryNumber, reason: voided.voidReason },
      },
      executor,
    );
    return voided;
  });
}

/**
 * Approves or rejects a pending entry. Needs `panel.approve`, which is the whole
 * point of the approval switch: it is a permission the owner hands to few. The
 * rule that nobody decides their own entry is in the logic, not here.
 */
export async function decidePanelEntry(
  entryId: string,
  decision: "approve" | "reject",
  note: string,
) {
  const session = await assertPermission("panel.approve");
  await getSettings();
  const db = await getDb();

  return db.transaction(async (tx) => {
    const executor = tx as unknown as typeof db;
    const decided = await decideEntry(executor, {
      entryId,
      decision,
      note,
      actorId: session.user.id,
      actorIsOwner: session.user.isOwner,
    });
    await recordAudit(
      {
        userId: session.user.id,
        actorLabel: session.user.username,
        action: decision === "approve" ? "panel.entry_approved" : "panel.entry_rejected",
        entityType: "panel_entries",
        entityId: decided.id,
        after: { entryNumber: decided.entryNumber, status: decided.status, note: decided.decisionNote },
      },
      executor,
    );
    return decided;
  });
}

/** How many entries are waiting, for whoever may decide them. */
export async function panelPending() {
  await assertPermission("panel.approve");
  return panelPendingCount(await getDb());
}

/** What the order form needs to offer PPN. Needs `panel.create`: it exists to fill that form. */
export async function panelTaxInfo() {
  await assertPermission("panel.create");
  return panelTaxChoices(await getDb());
}

/**
 * The screen's data: entries, totals, and whether the reader may see costs.
 *
 * Cost prices and margins are the pharmacy's purchase terms, which the split
 * between `reports.sales` and `reports.financial` keeps off the shop floor.
 * The screen hiding a column would not be a control, so they are removed here,
 * before the data leaves the DAL: someone without `reports.financial` gets the
 * selling side only.
 */
export async function panelOverview(range: PanelRange, only?: { status: "pending" }) {
  const session = await assertPermission("panel.view");
  await getSettings();
  const db = await getDb();
  const canSeeCost = can(session.grant, "reports.financial");

  const [{ rows, truncated }, totals] = await Promise.all([
    listPanelRows(db, range, 200, only),
    panelTotals(db, range),
  ]);

  return { canSeeCost, truncated, ...applyCostVisibility({ rows, totals }, canSeeCost) };
}

/**
 * Everything in a window, for a download: no row cap, costs removed on the same
 * terms as the screen. A route handler is as exposed as a page, so the
 * permission is checked here and not assumed from the link that led to it.
 */
export async function panelExport(range: PanelRange) {
  const session = await assertPermission("panel.view");
  await getSettings();
  const db = await getDb();
  const canSeeCost = can(session.grant, "reports.financial");

  const [{ rows }, totals] = await Promise.all([
    listPanelRows(db, range, null),
    panelTotals(db, range),
  ]);

  return { canSeeCost, ...applyCostVisibility({ rows, totals }, canSeeCost) };
}

/** The item picker. Needs `panel.create`: it exists only to fill that form. */
export async function panelItemSearch(query: string, limit = 10) {
  await assertPermission("panel.create");
  return searchPanelItems(await getDb(), query, limit);
}

export async function panelPharmacists() {
  await assertPermission("panel.create");
  return pharmacistChoices(await getDb());
}
