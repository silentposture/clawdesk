import { Bug, Download, Send, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createDiagnosticReport, type DiagnosticReport } from "../lib/diagnostics";
import type { LegalConsentRecord } from "../lib/legalConsent";
import { useI18n } from "../lib/i18n";
import { Tooltip } from "./Tooltip";

interface DiagnosticsPanelProps {
  gatewayBaseUrl?: string;
  legalConsent?: LegalConsentRecord;
  onClose: () => void;
}

export function DiagnosticsPanel({ gatewayBaseUrl, legalConsent, onClose }: DiagnosticsPanelProps): JSX.Element {
  const { t } = useI18n();
  const [checklist, setChecklist] = useState<string[]>([]);
  const [report, setReport] = useState<DiagnosticReport>();
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const fallbackChecklist = [
    t("diagnostics.noEmail"),
    t("diagnostics.noFullPath"),
    t("diagnostics.noFullKey"),
    t("diagnostics.noApiKey"),
    t("diagnostics.noChat"),
    t("diagnostics.noScreenshot"),
  ];
  const releaseStatus = [
    { label: t("diagnostics.releaseChannel"), value: "beta-direct Windows x64 NSIS" },
    { label: t("diagnostics.installerSignature"), value: t("diagnostics.signatureValue") },
    { label: t("diagnostics.gateway"), value: gatewayBaseUrl ? t("diagnostics.connected") : t("diagnostics.offlineFallback") },
    { label: t("diagnostics.paymentLicense"), value: t("diagnostics.paymentValue") },
  ];

  useEffect(() => {
    void loadSummary();
  }, [gatewayBaseUrl, legalConsent]);

  function legalConsentSummary() {
    return legalConsent
      ? {
          version: legalConsent.version,
          acceptedAt: legalConsent.acceptedAt,
          documentHash: legalConsent.documentHash,
          documents: legalConsent.documents,
        }
      : undefined;
  }

  function attachLegalConsentSummary(nextReport: DiagnosticReport): DiagnosticReport {
    const summary = legalConsentSummary();
    return summary ? { ...nextReport, legalConsentSummary: summary } : nextReport;
  }

  async function loadSummary() {
    if (!gatewayBaseUrl) return;
    try {
      const response = await fetch(`${gatewayBaseUrl}/diagnostics/summary`);
      if (!response.ok) throw new Error("bad response");
      const payload = (await response.json()) as { privacyChecklist: string[]; preview: DiagnosticReport };
      setChecklist(payload.privacyChecklist);
      setReport(attachLegalConsentSummary(payload.preview));
    } catch {
      setChecklist(fallbackChecklist);
      setReport(attachLegalConsentSummary(createDiagnosticReport({
        faultCode: "CLWD-GW-2001",
        recentErrors: ["Gateway diagnostics summary unavailable"],
      })));
      setError(t("diagnostics.gatewayFallback"));
    }
  }

  async function createReport() {
    if (!gatewayBaseUrl) return;
    try {
      const response = await fetch(`${gatewayBaseUrl}/diagnostics/create-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          faultCode: "CLWD-UI-4001",
          legalConsentSummary: legalConsentSummary(),
          userDescription: description,
        }),
      });
      const payload = (await response.json()) as { report?: DiagnosticReport; error?: string };
      if (!response.ok || !payload?.report) {
        throw new Error(payload?.error || t("diagnostics.createFailed"));
      }
      setReport(payload.report);
      setMessage(t("diagnostics.created"));
      setError(undefined);
    } catch (error) {
      setReport(attachLegalConsentSummary(createDiagnosticReport({
        faultCode: "CLWD-UI-4001",
        recentErrors: [error instanceof Error ? error.message : "Gateway create report failed"],
        legalConsentSummary: legalConsentSummary(),
        userDescription: description,
      })));
      setMessage(t("diagnostics.gatewayLocal"));
      setError(undefined);
    }
  }

  async function submitReport() {
    if (!gatewayBaseUrl || !report) return;
    const response = await fetch(`${gatewayBaseUrl}/diagnostics/submit-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ report }),
    });
    if (response.ok) setMessage(t("diagnostics.submitted"));
  }

  function exportForSupport() {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${report.reportId || "clawdesk-diagnostics"}-support.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setMessage(t("diagnostics.exported"));
  }

  return (
    <div className="panel-backdrop" role="presentation">
      <section className="diagnostics-panel" role="dialog" aria-modal="true" aria-labelledby="diagnostics-title">
        <header className="provider-header">
          <div>
            <h2 id="diagnostics-title">{t("diagnostics.title")}</h2>
            <p>{t("diagnostics.subtitle")}</p>
          </div>
          <button className="icon-button" type="button" aria-label={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="commercial-grid">
          <section className="commercial-card">
            <Bug size={23} />
            <h3>{t("diagnostics.problem")}</h3>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t("diagnostics.placeholder")} />
            <div className="panel-actions">
              <Tooltip text={t("diagnostics.createTooltip")}>
                <button className="primary-button" type="button" onClick={createReport}>
                  {t("diagnostics.create")}
                </button>
              </Tooltip>
              <button className="secondary-button" type="button" disabled={!report} onClick={submitReport}>
                <Send size={16} />
                {t("diagnostics.submit")}
              </button>
              <button className="secondary-button" type="button" disabled={!report} onClick={exportForSupport}>
                <Download size={16} />
                {t("diagnostics.exportSupport")}
              </button>
            </div>
            {report ? <pre className="diagnostic-preview">{JSON.stringify(report, null, 2)}</pre> : null}
          </section>
          <section className="commercial-card">
            <ShieldCheck size={23} />
            <h3>{t("diagnostics.privacy")}</h3>
            <ul>
              {checklist.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>
          <section className="commercial-card">
            <ShieldCheck size={23} />
            <h3>{t("diagnostics.betaStatus")}</h3>
            <dl className="status-list">
              {releaseStatus.map((item) => (
                <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>
              ))}
            </dl>
          </section>
        </div>
        {message ? <p className="panel-success">{message}</p> : null}
        {error ? <p className="panel-error">{error}</p> : null}
      </section>
    </div>
  );
}
