import { Bug, Download, Send, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createDiagnosticReport, type DiagnosticReport } from "../lib/diagnostics";
import type { LegalConsentRecord } from "../lib/legalConsent";
import { Tooltip } from "./Tooltip";

interface DiagnosticsPanelProps {
  gatewayBaseUrl?: string;
  legalConsent?: LegalConsentRecord;
  onClose: () => void;
}

export function DiagnosticsPanel({ gatewayBaseUrl, legalConsent, onClose }: DiagnosticsPanelProps): JSX.Element {
  const [checklist, setChecklist] = useState<string[]>([]);
  const [report, setReport] = useState<DiagnosticReport>();
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const fallbackChecklist = [
    "不含 Email",
    "不含完整路徑",
    "不含完整金鑰",
    "不含 API key",
    "不含聊天內容",
    "不含螢幕截圖",
  ];
  const releaseStatus = [
    { label: "Release channel", value: "beta-direct Windows x64 NSIS" },
    { label: "Installer signature", value: "signtool / release guard 驗證" },
    { label: "Gateway", value: gatewayBaseUrl ? "connected" : "offline fallback" },
    { label: "Payment/license", value: "Lemon Squeezy hosted checkout + license key" },
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
      setError("無法讀取 Gateway 診斷摘要，已改用本機去識別化摘要。");
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
        throw new Error(payload?.error || "產生診斷包失敗");
      }
      setReport(payload.report);
      setMessage("診斷包已在本機產生，尚未上傳。");
      setError(undefined);
    } catch (error) {
      setReport(attachLegalConsentSummary(createDiagnosticReport({
        faultCode: "CLWD-UI-4001",
        recentErrors: [error instanceof Error ? error.message : "Gateway create report failed"],
        legalConsentSummary: legalConsentSummary(),
        userDescription: description,
      })));
      setMessage("Gateway 暫時無法回應，已改用本機產生診斷包，尚未上傳。");
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
    if (response.ok) setMessage("已模擬送出故障回報。正式版仍會在送出前要求使用者確認。");
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
    setMessage("已匯出客服診斷包；內容仍維持去識別化。");
  }

  return (
    <div className="panel-backdrop" role="presentation">
      <section className="diagnostics-panel" role="dialog" aria-modal="true" aria-labelledby="diagnostics-title">
        <header className="provider-header">
          <div>
            <h2 id="diagnostics-title">故障回報</h2>
            <p>自動整理非個資診斷摘要，但不自動上傳；使用者確認後才送出或匯出。</p>
          </div>
          <button className="icon-button" type="button" aria-label="關閉" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="commercial-grid">
          <section className="commercial-card">
            <Bug size={23} />
            <h3>問題描述</h3>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="簡單描述發生什麼事，請勿貼密碼、金鑰或個人資料。" />
            <div className="panel-actions">
              <Tooltip text="只在本機建立診斷包，內容會先去識別化。">
                <button className="primary-button" type="button" onClick={createReport}>
                  產生診斷包
                </button>
              </Tooltip>
              <button className="secondary-button" type="button" disabled={!report} onClick={submitReport}>
                <Send size={16} />
                手動送出
              </button>
              <button className="secondary-button" type="button" disabled={!report} onClick={exportForSupport}>
                <Download size={16} />
                匯出給客服
              </button>
            </div>
            {report ? <pre className="diagnostic-preview">{JSON.stringify(report, null, 2)}</pre> : null}
          </section>
          <section className="commercial-card">
            <ShieldCheck size={23} />
            <h3>隱私檢查清單</h3>
            <ul>
              {checklist.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>
          <section className="commercial-card">
            <ShieldCheck size={23} />
            <h3>Beta 發佈狀態</h3>
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
