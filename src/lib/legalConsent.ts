import {
  legalConsentDocumentHash,
  legalConsentDocuments as legalConsentDocumentManifest,
  legalConsentVersion,
} from "./legalConsentManifest";

export interface LegalConsentRecord {
  version: string;
  acceptedAt: string;
  documentHash: string;
  documents: string[];
}

export { legalConsentVersion };
export const legalConsentDocuments = legalConsentDocumentManifest.map((document) => document.path);
export const legalConsentStorageKey = "clawdesk_legal_consent";

export function stableHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function currentLegalDocumentHash(): string {
  return legalConsentDocumentHash;
}

export function createLegalConsentRecord(now = new Date()): LegalConsentRecord {
  return {
    version: legalConsentVersion,
    acceptedAt: now.toISOString(),
    documentHash: currentLegalDocumentHash(),
    documents: [...legalConsentDocuments],
  };
}

export function parseLegalConsentRecord(raw: string | null | undefined): LegalConsentRecord | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<LegalConsentRecord>;
    if (
      parsed.version !== legalConsentVersion
      || parsed.documentHash !== currentLegalDocumentHash()
      || typeof parsed.acceptedAt !== "string"
      || !Array.isArray(parsed.documents)
      || parsed.documents.length !== legalConsentDocuments.length
    ) {
      return undefined;
    }
    const parsedDocuments = parsed.documents.map(String);
    if (!legalConsentDocuments.every((document) => parsedDocuments.includes(document))) {
      return undefined;
    }
    return {
      version: parsed.version,
      acceptedAt: parsed.acceptedAt,
      documentHash: parsed.documentHash,
      documents: parsedDocuments,
    };
  } catch {
    return undefined;
  }
}

export function readLegalConsentRecord(storage: Storage | undefined = globalThis.localStorage): LegalConsentRecord | undefined {
  try {
    return parseLegalConsentRecord(storage?.getItem(legalConsentStorageKey));
  } catch {
    return undefined;
  }
}

export function writeLegalConsentRecord(
  record: LegalConsentRecord,
  storage: Storage | undefined = globalThis.localStorage,
): void {
  storage?.setItem(legalConsentStorageKey, JSON.stringify(record));
}
