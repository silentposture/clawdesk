import { useMemo, useState } from "react";
import { FileCheck2, ShieldCheck } from "lucide-react";
import { useI18n } from "../lib/i18n";
import {
  createLegalConsentRecord,
  currentLegalDocumentHash,
  legalConsentVersion,
  type LegalConsentRecord,
} from "../lib/legalConsent";

interface LegalConsentModalProps {
  onAccept: (record: LegalConsentRecord) => void;
}

export function LegalConsentModal({ onAccept }: LegalConsentModalProps): JSX.Element {
  const { t } = useI18n();
  const [accepted, setAccepted] = useState(false);
  const documentHash = useMemo(() => currentLegalDocumentHash(), []);

  function accept() {
    if (!accepted) return;
    onAccept(createLegalConsentRecord());
  }

  return (
    <div className="panel-backdrop legal-consent-backdrop" role="presentation">
      <section className="legal-consent-panel" role="dialog" aria-modal="true" aria-labelledby="legal-consent-title">
        <header className="provider-header">
          <div>
            <h2 id="legal-consent-title">{t("legalConsent.title")}</h2>
            <p>{t("legalConsent.description")}</p>
          </div>
          <FileCheck2 size={24} />
        </header>

        <div className="legal-consent-summary">
          <article>
            <ShieldCheck size={20} />
            <div>
              <strong>{t("legalConsent.installTitle")}</strong>
              <p>{t("legalConsent.installBody")}</p>
            </div>
          </article>
          <article>
            <ShieldCheck size={20} />
            <div>
              <strong>{t("legalConsent.subscriptionTitle")}</strong>
              <p>{t("legalConsent.subscriptionBody")}</p>
            </div>
          </article>
          <article>
            <ShieldCheck size={20} />
            <div>
              <strong>{t("legalConsent.openSourceTitle")}</strong>
              <p>{t("legalConsent.openSourceBody")}</p>
            </div>
          </article>
          <article>
            <ShieldCheck size={20} />
            <div>
              <strong>{t("legalConsent.privacyTitle")}</strong>
              <p>{t("legalConsent.privacyBody")}</p>
            </div>
          </article>
        </div>

        <label className="legal-consent-check">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(event) => setAccepted(event.target.checked)}
          />
          <span>{t("legalConsent.checkbox")}</span>
        </label>

        <dl className="legal-consent-meta">
          <div>
            <dt>{t("legalConsent.version")}</dt>
            <dd>{legalConsentVersion}</dd>
          </div>
          <div>
            <dt>{t("legalConsent.hash")}</dt>
            <dd>{documentHash}</dd>
          </div>
        </dl>

        <footer className="setup-actions">
          <button className="primary-button" type="button" disabled={!accepted} onClick={accept}>
            {t("legalConsent.accept")}
          </button>
        </footer>
      </section>
    </div>
  );
}
