export interface DiagnosticReport {
  reportId: string;
  faultCode: string;
  createdAt: string;
  appVersion: string;
  systemSummary: string;
  licenseSummary: string;
  gatewaySummary: string;
  recentErrors: string[];
  redactionStatus: "clean" | "redacted";
  legalConsentSummary?: LegalConsentSummary;
  userDescription?: string;
}

export interface LegalConsentSummary {
  version: string;
  acceptedAt: string;
  documentHash: string;
  documents: string[];
}

const secretPatterns = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{8,}\b/g,
  /\bsk-or-v1-[A-Za-z0-9_-]{8,}\b/g,
  /\bgsk_[A-Za-z0-9_-]{8,}\b/g,
  /\bxai-[A-Za-z0-9_-]{8,}\b/g,
  /\bAIza[A-Za-z0-9_-]{8,}\b/g,
  /\bCLWD-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}\b/g,
  /\bCLWD-BETA-[A-Z0-9]{4}-[A-Z0-9]{4}\b/g,
  /\/Users\/[^/\s]+\/[^\s]+/g,
  /[A-Z]:\\(?:[^\\\s]+\\)*[^\\\s]+/gi,
  /\b(?:paddle_customer|lem_customer|lemon_customer)_[A-Za-z0-9_-]+\b/g,
];

export function isFaultCode(code: string): boolean {
  return /^CLWD-[A-Z]{2,4}-\d{4}$/.test(code);
}

export function redactDiagnosticText(input: string): string {
  return secretPatterns.reduce((text, pattern) => text.replace(pattern, "[REDACTED]"), input);
}

export function createDiagnosticReport(input: {
  faultCode: string;
  recentErrors: string[];
  legalConsentSummary?: LegalConsentSummary;
  userDescription?: string;
  now?: string;
}): DiagnosticReport {
  const createdAt = input.now ?? new Date().toISOString();
  const recentErrors = input.recentErrors.map(redactDiagnosticText);
  const description = input.userDescription ? redactDiagnosticText(input.userDescription) : undefined;
  return {
    reportId: `diag-${Date.parse(createdAt) || 0}`,
    faultCode: isFaultCode(input.faultCode) ? input.faultCode : "CLWD-UI-4001",
    createdAt,
    appVersion: "0.1.0",
    systemSummary: "Windows 11 x64, memory 16-32GB bucket, disk 100GB+ bucket",
    licenseSummary: "provider=lemon-license status=active customer=[HASHED]",
    gatewaySummary: "mock sidecar healthy",
    recentErrors,
    redactionStatus: recentErrors.join("\n") === input.recentErrors.join("\n") && description === input.userDescription ? "clean" : "redacted",
    legalConsentSummary: input.legalConsentSummary,
    userDescription: description,
  };
}

export function reportContainsPrivateData(report: DiagnosticReport): boolean {
  const serialized = JSON.stringify(report);
  return secretPatterns.some((pattern) => pattern.test(serialized));
}
