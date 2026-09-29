import type { SnapshotResponse } from "@/lib/offline/contract";
import type { SnapshotFile, StateFile, StoredUser } from "../src/storage-format";
import { EMPTY_STATE } from "../src/storage-format";

export const ISSUED = Date.parse("2026-09-28T01:00:00Z"); // 08:00 in Jakarta
export const HOUR = 3_600_000;

export function snapshot(over: Partial<SnapshotResponse> = {}, file: Partial<SnapshotFile> = {}): SnapshotFile {
  const data: SnapshotResponse = {
    serverTime: new Date(ISSUED).toISOString(),
    serverToday: "2026-09-28",
    settings: {
      businessName: "Apotek Sehat",
      businessAddress: null,
      businessPhone: null,
      npwp: null,
      licenceNumber: null,
      receiptFooter: null,
      receiptLocale: "id",
      timezone: "Asia/Jakarta",
      currencyCode: "IDR",
      currencyDecimals: 0,
    },
    tax: null,
    items: [
      {
        id: "item-para",
        code: "PARA500",
        genericName: "Paracetamol",
        brandName: null,
        strength: "500 mg",
        unit: "tablet",
        drugClass: "bebas",
        price: 1_000,
        isTaxExempt: false,
        barcodes: ["8991234567890"],
        batches: [
          { id: "b-soon", lotNumber: "SOON", expiryDate: "2026-12-31", qty: 5 },
          { id: "b-late", lotNumber: "LATE", expiryDate: "2027-12-31", qty: 20 },
        ],
      },
      {
        id: "item-amox",
        code: "AMOX",
        genericName: "Amoxicillin",
        brandName: null,
        strength: "500 mg",
        unit: "kapsul",
        drugClass: "keras",
        price: 2_500,
        isTaxExempt: true,
        barcodes: [],
        batches: [
          // Expires on the day of the pass: still good that whole day.
          { id: "b-today", lotNumber: "TODAY", expiryDate: "2026-09-28", qty: 3 },
          { id: "b-gone", lotNumber: "GONE", expiryDate: "2026-09-27", qty: 10 },
        ],
      },
    ],
    users: [],
    pass: {
      id: "pass-1",
      issuedAt: new Date(ISSUED).toISOString(),
      expiresAt: new Date(ISSUED + 24 * HOUR).toISOString(),
      maxSales: 3,
      maxTotal: 100_000,
    },
    device: { id: "dev-1", name: "HP Kasir", role: "till", code: "K7Q" },
    ...over,
  };
  return { receivedElapsed: 1_000_000, bootCount: 7, receivedWall: ISSUED, data, ...file };
}

export function state(over: Partial<StateFile> = {}): StateFile {
  return { ...EMPTY_STATE, wallHighWater: ISSUED, ...over };
}

export function cashier(over: Partial<StoredUser> = {}): StoredUser {
  return {
    id: "user-siti",
    username: "siti",
    fullName: "Siti Kasir",
    locale: "id",
    isOwner: false,
    isPharmacist: false,
    permissions: ["sales.create"],
    credentialStamp: "stamp-1",
    signedInAt: new Date(ISSUED - HOUR).toISOString(),
    verifier: { salt: "", hash: "", iterations: 1 },
    ...over,
  };
}
