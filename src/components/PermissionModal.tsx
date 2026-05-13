import { AlertTriangle, ShieldCheck, X } from "lucide-react";
import type { PermissionRequestEvent } from "../lib/events";
import { useI18n } from "../lib/i18n";

interface PermissionModalProps {
  request?: PermissionRequestEvent;
  onDecision: (allowed: boolean) => void;
}

export function PermissionModal({ request, onDecision }: PermissionModalProps): JSX.Element | null {
  if (!request) return null;
  const { t } = useI18n();
  const riskLabel = {
    low: t("common.low"),
    medium: t("common.medium"),
    high: t("common.high"),
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="permission-modal" role="dialog" aria-modal="true" aria-labelledby="permission-title">
        <div className="permission-icon">
          <AlertTriangle size={22} />
        </div>
        <div className="permission-copy">
          <h2 id="permission-title">{t("app.permission.title")}</h2>
          <p>{request.summary}</p>
          <dl>
            <div>
              <dt>{t("app.permission.action")}</dt>
              <dd>{request.action}</dd>
            </div>
            <div>
              <dt>{t("app.permission.target")}</dt>
              <dd>{request.target}</dd>
            </div>
            <div>
              <dt>{t("app.permission.risk")}</dt>
              <dd className={`risk-${request.risk}`}>{riskLabel[request.risk]}</dd>
            </div>
          </dl>
        </div>
        <div className="permission-actions">
          <button className="secondary-button" type="button" onClick={() => onDecision(false)}>
            <X size={16} />
            {t("app.permission.reject")}
          </button>
          <button className="primary-button" type="button" onClick={() => onDecision(true)}>
            <ShieldCheck size={16} />
            {t("app.permission.accept")}
          </button>
        </div>
      </section>
    </div>
  );
}
