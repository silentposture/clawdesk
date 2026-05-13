import {
  createLegalConsentRecord,
  currentLegalDocumentHash,
  legalConsentStorageKey,
  legalConsentVersion,
  parseLegalConsentRecord,
  readLegalConsentRecord,
  stableHash,
  writeLegalConsentRecord,
} from "./legalConsent";
import { describe, expect, it } from "vitest";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("legal consent", () => {
  it("creates deterministic consent metadata", () => {
    expect(stableHash("ClawDesk")).toBe(stableHash("ClawDesk"));
    const record = createLegalConsentRecord(new Date("2026-05-13T00:00:00.000Z"));
    expect(record.version).toBe(legalConsentVersion);
    expect(record.documentHash).toBe(currentLegalDocumentHash());
    expect(record.acceptedAt).toBe("2026-05-13T00:00:00.000Z");
  });

  it("rejects stale or tampered records", () => {
    const record = createLegalConsentRecord(new Date("2026-05-13T00:00:00.000Z"));
    expect(parseLegalConsentRecord(JSON.stringify(record))).toEqual(record);
    expect(parseLegalConsentRecord(JSON.stringify({ ...record, version: "old" }))).toBeUndefined();
    expect(parseLegalConsentRecord(JSON.stringify({ ...record, documentHash: "changed" }))).toBeUndefined();
    expect(parseLegalConsentRecord(JSON.stringify({ ...record, documents: ["docs/legal/INSTALLER_TERMS.md"] }))).toBeUndefined();
    expect(parseLegalConsentRecord("not json")).toBeUndefined();
  });

  it("persists consent in explicit storage", () => {
    const storage = memoryStorage();
    const record = createLegalConsentRecord(new Date("2026-05-13T00:00:00.000Z"));
    writeLegalConsentRecord(record, storage);
    expect(storage.getItem(legalConsentStorageKey)).toContain(legalConsentVersion);
    expect(readLegalConsentRecord(storage)).toEqual(record);
  });
});
