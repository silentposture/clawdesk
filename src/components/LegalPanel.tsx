import { Copyright, FileText, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { LegalConsentRecord } from "../lib/legalConsent";
import { buildLegalExportPackage } from "../lib/legalExport";
import { saveLegalExport } from "../lib/tauri";
import { useI18n } from "../lib/i18n";

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

const LEGAL_DEVELOPER_NAME = "Alisonsoftware";
const LEGAL_PRODUCT_NAME = "ClawDesk";
const SUPPORT_EMAIL = "alison.ai.tech.studio@gmail.com";

export function LegalPanel({ gatewayBaseUrl, legalConsent, onClose }: LegalPanelProps): JSX.Element {
  const { t } = useI18n();
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
      setError(t("legal.loadError"));
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
    setMessage(t("legal.previewReady"));
    setError(undefined);
  }

  async function exportJsonFile() {
    try {
      const savedPath = await saveLegalExport("clawdesk-legal-summary.json", createExportPayload());
      setMessage(savedPath ? t("legal.exported", { path: savedPath }) : t("legal.exportCancelled"));
      setError(undefined);
    } catch (error) {
      setError(error instanceof Error ? error.message : t("legal.exportError"));
    }
  }

  return (
    <div className="panel-backdrop" role="presentation">
      <section className="legal-panel" role="dialog" aria-modal="true" aria-labelledby="legal-title">
        <header className="provider-header">
          <div>
            <h2 id="legal-title">{t("legal.title")}</h2>
            <p>{t("legal.subtitle")}</p>
          </div>
          <button className="icon-button" type="button" aria-label={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="commercial-grid">
          <section className="commercial-card">
            <Copyright size={23} />
            <h3>{t("legal.developer.title")}</h3>
            <dl className="status-list">
              <div>
                <dt>{t("legal.developer.developer")}</dt>
                <dd>{LEGAL_DEVELOPER_NAME}</dd>
              </div>
              <div>
                <dt>{t("legal.developer.product")}</dt>
                <dd>{LEGAL_PRODUCT_NAME}</dd>
              </div>
              <div>
                <dt>{t("legal.developer.statusLabel")}</dt>
                <dd>{t("legal.developer.status")}</dd>
              </div>
            </dl>
            <p>{t("legal.developer.disclaimer")}</p>
          </section>
          <section className="commercial-card">
            <FileText size={23} />
            <h3>{t("legal.support.title")}</h3>
            <p>
              {t("legal.support.email")}
              <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
            </p>
            <p>{t("legal.support.beta")}</p>
            <small>{t("legal.support.guard")}</small>
          </section>
          {legalConsent ? (
            <section className="commercial-card legal-consent-status">
              <Copyright size={23} />
              <h3>{t("legal.consent.title")}</h3>
              <dl className="status-list">
                <div>
                  <dt>{t("legal.consent.version")}</dt>
                  <dd>{legalConsent.version}</dd>
                </div>
                <div>
                  <dt>{t("legal.consent.acceptedAt")}</dt>
                  <dd>{new Date(legalConsent.acceptedAt).toLocaleString()}</dd>
                </div>
                <div>
                  <dt>{t("legal.consent.hash")}</dt>
                  <dd>{legalConsent.documentHash}</dd>
                </div>
              </dl>
              <div className="panel-actions">
                <button className="secondary-button" type="button" onClick={createExportPreview}>
                  {t("legal.exportPreview")}
                </button>
                <button className="primary-button" type="button" onClick={exportJsonFile}>
                  {t("legal.exportJson")}
                </button>
              </div>
            </section>
          ) : null}
          <section className="commercial-card">
            <Copyright size={23} />
            <h3>{t("legal.documents.title")}</h3>
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
                      {t("legal.documents.source")}<a href={document.sourceUrl} target="_blank" rel="noreferrer">{t("legal.documents.official")}</a>
                    </small>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
          <section className="commercial-card">
            <FileText size={23} />
            <h3>{t("legal.notices.title")}</h3>
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
