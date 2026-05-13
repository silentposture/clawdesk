import { Copyright, FileText, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { LegalConsentRecord } from "../lib/legalConsent";
import { buildLegalExportPackage } from "../lib/legalExport";
import { saveLegalExport } from "../lib/tauri";

interface LegalPanelProps {
  gatewayBaseUrl?: string;
  legalConsent?: LegalConsentRecord;
  onClose: () => void;
}

interface LegalDocument {
  id: string;
  title: string;
  summary: string;
  details?: string[];
  sourceUrl?: string;
}

interface LegalNotice {
  package: string;
  license: string;
  purpose: string;
}

export function LegalPanel({ gatewayBaseUrl, legalConsent, onClose }: LegalPanelProps): JSX.Element {
  const [documents, setDocuments] = useState<LegalDocument[]>([]);
  const [notices, setNotices] = useState<LegalNotice[]>([]);
  const [exportPreview, setExportPreview] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    void load();
  }, [gatewayBaseUrl]);

  async function load() {
    if (!gatewayBaseUrl) return;
    try {
      const [documentResponse, noticesResponse] = await Promise.all([
        fetch(`${gatewayBaseUrl}/legal/documents`),
        fetch(`${gatewayBaseUrl}/legal/notices`),
      ]);
      if (!documentResponse.ok || !noticesResponse.ok) throw new Error("bad response");
      setDocuments(((await documentResponse.json()) as { documents: LegalDocument[] }).documents);
      setNotices(((await noticesResponse.json()) as { notices: LegalNotice[] }).notices);
    } catch {
      setError("無法讀取版權與授權資料。");
    }
  }

  function createExportPayload(): string {
    const payload = buildLegalExportPackage({
      legalConsent,
      documents,
      notices,
    });
    return JSON.stringify(payload, null, 2);
  }

  function createExportPreview() {
    setExportPreview(createExportPayload());
    setMessage("法務摘要已在畫面中產生，尚未寫入檔案。");
    setError(undefined);
  }

  async function exportJsonFile() {
    try {
      const savedPath = await saveLegalExport("clawdesk-legal-summary.json", createExportPayload());
      setMessage(savedPath ? `已匯出：${savedPath}` : "已取消匯出，未寫入檔案。");
      setError(undefined);
    } catch (error) {
      setError(error instanceof Error ? error.message : "法務摘要匯出失敗。");
    }
  }

  return (
    <div className="panel-backdrop" role="presentation">
      <section className="legal-panel" role="dialog" aria-modal="true" aria-labelledby="legal-title">
        <header className="provider-header">
          <div>
            <h2 id="legal-title">版權與授權中心</h2>
            <p>ClawDesk 採閉源商業授權，同時顯示安裝同意、訂閱揭露、使用者內容權利與 OpenClaw MIT 聲明。</p>
          </div>
          <button className="icon-button" type="button" aria-label="關閉" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="commercial-grid">
          {legalConsent ? (
            <section className="commercial-card legal-consent-status">
              <Copyright size={23} />
              <h3>已同意條款紀錄</h3>
              <dl className="status-list">
                <div>
                  <dt>版本</dt>
                  <dd>{legalConsent.version}</dd>
                </div>
                <div>
                  <dt>同意時間</dt>
                  <dd>{new Date(legalConsent.acceptedAt).toLocaleString()}</dd>
                </div>
                <div>
                  <dt>文件 hash</dt>
                  <dd>{legalConsent.documentHash}</dd>
                </div>
              </dl>
              <div className="panel-actions">
                <button className="secondary-button" type="button" onClick={createExportPreview}>
                  產生法務匯出摘要
                </button>
                <button className="primary-button" type="button" onClick={exportJsonFile}>
                  匯出 JSON 檔
                </button>
              </div>
            </section>
          ) : null}
          <section className="commercial-card">
            <Copyright size={23} />
            <h3>法律文件</h3>
            <div className="stack-list">
              {documents.map((document) => (
                <article key={document.id}>
                  <strong>{document.title}</strong>
                  <p>{document.summary}</p>
                  {document.details?.length ? (
                    <ul className="legal-detail-list">
                      {document.details.map((detail) => (
                        <li key={detail}>{detail}</li>
                      ))}
                    </ul>
                  ) : null}
                  {document.sourceUrl ? (
                    <small>
                      參考來源：<a href={document.sourceUrl} target="_blank" rel="noreferrer">官方文件</a>
                    </small>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
          <section className="commercial-card">
            <FileText size={23} />
            <h3>第三方 NOTICE</h3>
            <div className="stack-list">
              {notices.map((notice) => (
                <article key={notice.package}>
                  <strong>{notice.package}</strong>
                  <small>{notice.license} · {notice.purpose}</small>
                </article>
              ))}
            </div>
          </section>
        </div>
        {exportPreview ? <pre className="diagnostic-preview">{exportPreview}</pre> : null}
        {message ? <p className="panel-success">{message}</p> : null}
        {error ? <p className="panel-error">{error}</p> : null}
      </section>
    </div>
  );
}
