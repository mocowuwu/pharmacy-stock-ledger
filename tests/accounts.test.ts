import { describe, expect, it } from "vitest";
import {
  cleanPermissions,
  isValidUsername,
  normaliseUsername,
  permissionsToStore,
  refusalToSaveSettings,
  refusalToSuspend,
} from "@/lib/accounts/rules";
import { PERMISSION_TEMPLATES } from "@/lib/auth/permissions";
import {
  MODULES,
  MODULE_DRUG_CLASSES,
  MODULE_SETTING,
  moduleFlags,
} from "@/lib/catalogue/modules";

const owner = { id: "owner-1", isOwner: true, status: "active" as const };
const staff = { id: "staff-1", isOwner: false, status: "active" as const };

describe("suspending an account", () => {
  it("refuses to suspend the owner", () => {
    // Nobody above the owner could rescue the account. Recovery needs the
    // machine the database runs on.
    expect(refusalToSuspend({ id: "staff-1", isOwner: false }, owner)).toBe(
      "cannot_suspend_owner",
    );
    expect(refusalToSuspend({ id: "owner-1", isOwner: true }, owner)).toBe(
      "cannot_suspend_owner",
    );
  });

  it("refuses to let anyone suspend themselves", () => {
    expect(refusalToSuspend({ id: "staff-1", isOwner: false }, staff)).toBe(
      "cannot_suspend_self",
    );
  });

  it("allows suspending somebody else", () => {
    expect(refusalToSuspend({ id: "owner-1", isOwner: true }, staff)).toBeNull();
  });
});

describe("usernames", () => {
  it("lowercases, so the audit log cannot show two spellings of one person", () => {
    expect(normaliseUsername("  Budi  ")).toBe("budi");
  });

  it("accepts what a pharmacy would actually type", () => {
    expect(isValidUsername("budi")).toBe(true);
    expect(isValidUsername("siti.kasir")).toBe(true);
    expect(isValidUsername("apoteker-2")).toBe(true);
  });

  it("refuses anything that would be ambiguous or unusable", () => {
    expect(isValidUsername("ab")).toBe(false);
    expect(isValidUsername("budi santoso")).toBe(false);
    expect(isValidUsername("budi@apotek")).toBe(false);
    expect(isValidUsername("")).toBe(false);
  });
});

describe("permissions", () => {
  it("drops anything not in the catalogue", () => {
    // A permission the code no longer checks would grant nothing while looking
    // on screen as though it grants something.
    expect(cleanPermissions(["sales.create", "sales.teleport"])).toEqual([
      "sales.create",
    ]);
  });

  it("returns them in catalogue order, not the order they were ticked", () => {
    expect(cleanPermissions(["alerts.view", "items.view", "sales.create"])).toEqual([
      "items.view",
      "sales.create",
      "alerts.view",
    ]);
  });

  it("stores nothing for the owner, whatever was submitted", () => {
    // The owner holds everything implicitly. Rows would imply an editable set.
    expect(permissionsToStore({ isOwner: true }, ["items.view"])).toEqual([]);
    expect(permissionsToStore({ isOwner: false }, ["items.view"])).toEqual([
      "items.view",
    ]);
  });

  it("keeps every template made of real permissions", () => {
    for (const [name, template] of Object.entries(PERMISSION_TEMPLATES)) {
      expect(cleanPermissions(template), name).toHaveLength(template.length);
    }
  });
});

describe("settings", () => {
  const base = {
    businessName: "Apotek Klinik",
    expiringUrgentDays: 30,
    expiringNoticeDays: 90,
    deadStockNoSaleDays: 90,
    deadStockExpiryDays: 180,
    digestEnabled: false,
    digestEmail: null,
  };

  it("accepts a sensible set", () => {
    expect(refusalToSaveSettings(base)).toBeNull();
  });

  it("refuses an urgent window wider than the notice window", () => {
    // Otherwise the red alert fires after the amber one, which reads as the
    // system being broken rather than as a setting being wrong.
    expect(
      refusalToSaveSettings({ ...base, expiringUrgentDays: 120 }),
    ).toBe("urgent_window_too_wide");
    expect(
      refusalToSaveSettings({ ...base, expiringUrgentDays: 90 }),
    ).toBe("urgent_window_too_wide");
  });

  it("refuses thresholds that are not whole days", () => {
    expect(refusalToSaveSettings({ ...base, expiringUrgentDays: 0 })).toBe(
      "invalid_days",
    );
    expect(refusalToSaveSettings({ ...base, deadStockExpiryDays: 7.5 })).toBe(
      "invalid_days",
    );
  });

  it("refuses a digest with nowhere to send it", () => {
    expect(refusalToSaveSettings({ ...base, digestEnabled: true })).toBe(
      "digest_email_required",
    );
    expect(
      refusalToSaveSettings({ ...base, digestEnabled: true, digestEmail: "  " }),
    ).toBe("digest_email_required");
  });

  it("insists on a business name, which the receipt prints", () => {
    expect(refusalToSaveSettings({ ...base, businessName: " " })).toBe(
      "name_required",
    );
  });
});

describe("module switches", () => {
  it("reads each switch off its own settings column", () => {
    const flags = moduleFlags({
      returnsEnabled: true,
      barcodesEnabled: false,
      taxEnabled: false,
      narkotikaEnabled: true,
    });
    expect(flags).toEqual({
      returns: true,
      barcodes: false,
      tax: false,
      narkotika: true,
    });
  });

  it("names a settings column for every module", () => {
    for (const key of MODULES) {
      expect(MODULE_SETTING[key], key).toBeTruthy();
    }
  });

  it("gates only the two classes that need a register", () => {
    // Everything else stays available: a switch that hid obat keras would make
    // the catalogue lie about what is on the shelf.
    expect(MODULE_DRUG_CLASSES.narkotika).toEqual(["psikotropika", "narkotika"]);
    expect(MODULE_DRUG_CLASSES.returns).toBeUndefined();
  });
});
