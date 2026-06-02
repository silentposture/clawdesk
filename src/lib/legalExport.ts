import type { LegalConsentRecord } from "./legalConsent";

export interface LegalExportDocument {
  id: string;
  title: string;
  summary: string;
}

export interface LegalExportNotice {
  package: string;
  license: string;
  purpose: string;
}

export interface LegalExportPackage {
  exportedAt: string;
  product: "ClawDesk";
  developer: "Alisonsoftware";
  publisherStatus: "individual-developer";
  scope: "legal-summary";
  legalConsent?: Pick<LegalConsentRecord, "version" | "acceptedAt" | "documentHash" | "documents">;
  documents: LegalExportDocument[];
  notices: LegalExportNotice[];
  privacy: {
    containsPersonalData: false;
    containsSecrets: false;
    excluded: string[];
  };
}

export function buildLegalExportPackage(input: {
  legalConsent?: LegalConsentRecord;
  documents: LegalExportDocument[];
  notices: LegalExportNotice[];
  now?: string;
}): LegalExportPackage {
  return {
    exportedAt: input.now ?? new Date().toISOString(),
    product: "ClawDesk",
    developer: "Alisonsoftware",
    publisherStatus: "individual-developer",
    scope: "legal-summary",
    legalConsent: input.legalConsent
      ? {
          version: input.legalConsent.version,
          acceptedAt: input.legalConsent.acceptedAt,
          documentHash: input.legalConsent.documentHash,
          documents: [...input.legalConsent.documents],
        }
      : undefined,
    documents: input.documents.map((document) => ({
      id: document.id,
      title: document.title,
      summary: document.summary,
    })),
    notices: input.notices.map((notice) => ({
      package: notice.package,
      license: notice.license,
      purpose: notice.purpose,
    })),
    privacy: {
      containsPersonalData: false,
      containsSecrets: false,
      excluded: ["Email", "API key", "完整授權金鑰", "付款識別碼", "完整檔案路徑", "聊天內容"],
    },
  };
}
