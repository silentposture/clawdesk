import { CheckCircle2, CreditCard, KeyRound, RefreshCw, ShieldAlert, Undo2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { LicenseStatus, PricingPlan } from "../lib/licensing";
import { useI18n } from "../lib/i18n";
import {
  buildReleaseReadinessMatrix,
  defaultMockCandidateReadiness,
  summarizeReleaseReadiness,
} from "../lib/releaseReadiness";
import { Tooltip } from "./Tooltip";

interface LicensePanelProps {
  gatewayBaseUrl?: string;
  onClose: () => void;
}

interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  eligibleLatestVersion: string;
  supportUpdatesUntil: string;
  canInstallLatest: boolean;
  downloadUrl?: string | null;
  releaseNotes: string[];
  requiresRenewal: boolean;
}

export function LicensePanel({ gatewayBaseUrl, onClose }: LicensePanelProps): JSX.Element {
  const { t } = useI18n();
  const [status, setStatus] = useState<LicenseStatus>();
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [update, setUpdate] = useState<UpdateInfo>();
  const [licenseKey, setLicenseKey] = useState("CLWD-BETA-PRO1-2026");
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const readinessMatrix = buildReleaseReadinessMatrix(defaultMockCandidateReadiness);
  const readinessSummary = summarizeReleaseReadiness(readinessMatrix);

  useEffect(() => {
    void load();
  }, [gatewayBaseUrl]);

  async function load() {
    if (!gatewayBaseUrl) return;
    try {
      const [licenseResponse, updateResponse] = await Promise.all([
        fetch(`${gatewayBaseUrl}/license/status`),
        fetch(`${gatewayBaseUrl}/updates/check`),
      ]);
      if (!licenseResponse.ok || !updateResponse.ok) throw new Error("bad response");
      const licensePayload = (await licenseResponse.json()) as { status: LicenseStatus; pricingPlans: PricingPlan[] };
      setStatus(licensePayload.status);
      setPlans(licensePayload.pricingPlans);
      setUpdate((await updateResponse.json()) as UpdateInfo);
    } catch {
      setError(t("license.error"));
    }
  }

  async function activate() {
    if (!gatewayBaseUrl) return;
    setMessage(undefined);
    setError(undefined);
    try {
      const response = await fetch(`${gatewayBaseUrl}/license/activate-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ licenseKey }),
      });
      const payload = (await response.json()) as { status: LicenseStatus };
      setStatus(payload.status);
      if (!response.ok) {
        setError(t("license.validationError"));
      } else {
        setMessage(t("license.activateSuccess"));
      }
      await load();
    } catch {
      setError(t("license.activateError"));
    }
  }

  async function validateTamper() {
    if (!gatewayBaseUrl) return;
    const response = await fetch(`${gatewayBaseUrl}/license/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ licenseFile: "TAMPERED-LICENSE-FILE" }),
    });
    const payload = (await response.json()) as { status: LicenseStatus };
    setStatus(payload.status);
    setMessage(t("license.tamperWarning"));
  }

  async function renewSupport() {
    if (!gatewayBaseUrl) return;
    const response = await fetch(`${gatewayBaseUrl}/updates/mock-renew-support`, { method: "POST" });
    const payload = (await response.json()) as { status: LicenseStatus; update: UpdateInfo };
    setStatus(payload.status);
    setUpdate(payload.update);
    setMessage(t("license.renewSuccess"));
  }

  async function simulateLemonEvent(eventType: "refund_created" | "subscription_cancelled") {
    if (!gatewayBaseUrl) return;
    const response = await fetch(`${gatewayBaseUrl}/webhooks/lemon/mock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventType, licenseKey }),
    });
    const payload = (await response.json()) as { status: LicenseStatus };
    setStatus(payload.status);
    setMessage(eventType === "refund_created" ? "已模擬退款 webhook，授權降級為 safe-mode。" : "已模擬取消訂閱 webhook，授權降級為 safe-mode。");
  }

  return (
    <div className="panel-backdrop" role="presentation">
      <section className="license-panel" role="dialog" aria-modal="true" aria-labelledby="license-title">
        <header className="provider-header">
          <div>
            <h2 id="license-title">{t("license.title")}</h2>
            <p>{t("license.subtitle")}</p>
          </div>
          <button className="icon-button" type="button" aria-label={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="commercial-grid">
          <section className="commercial-card">
            <KeyRound size={23} />
            <h3>Lemon Squeezy beta license</h3>
            <label>
              {t("license.keyLabel")}
              <input value={licenseKey} onChange={(event) => setLicenseKey(event.target.value)} />
            </label>
            <div className="panel-actions">
              <Tooltip text="第一次啟用會送出 salted machine fingerprint，不送明文硬體序號。">
                <button className="primary-button" type="button" onClick={activate}>
                  <CheckCircle2 size={16} />
                  {t("license.activate")}
                </button>
              </Tooltip>
              <Tooltip text="模擬有人修改 license file 或更新到期日，應立即降級 safe mode。">
                <button className="secondary-button" type="button" onClick={validateTamper}>
                  <ShieldAlert size={16} />
                  {t("license.tamper")}
                </button>
              </Tooltip>
              <Tooltip text="模擬退款或撤銷後的客服降權流程。">
                <button className="secondary-button" type="button" onClick={() => simulateLemonEvent("refund_created")}>
                  <Undo2 size={16} />
                  模擬退款降權
                </button>
              </Tooltip>
            </div>
            {status ? (
              <dl className="status-list">
                <div><dt>付款供應商</dt><dd>{status.paymentProvider}</dd></div>
                <div><dt>授權供應商</dt><dd>{status.licenseProvider}</dd></div>
                <div><dt>{t("license.featurePlan")}</dt><dd>{status.plan}</dd></div>
                <div><dt>{t("license.featureStatus")}</dt><dd>{status.status}</dd></div>
                <div><dt>{t("license.featureDeviceLimit")}</dt><dd>{status.deviceLimit}</dd></div>
                <div><dt>{t("license.featureMachines")}</dt><dd>{status.machines.length} 台</dd></div>
                <div><dt>Entitlement</dt><dd>{status.entitlement?.status ?? "none"}</dd></div>
                <div><dt>License hash</dt><dd>{status.entitlement?.licenseKeyHash ?? "none"}</dd></div>
                <div><dt>Offline grace</dt><dd>{status.offlineGraceUntil ?? status.entitlement?.graceUntil ?? "none"}</dd></div>
                <div><dt>{t("license.featureValidationCode")}</dt><dd>{status.lastValidationCode ?? "none"}</dd></div>
              </dl>
            ) : null}
          </section>

          <section className="commercial-card">
            <RefreshCw size={23} />
            <h3>{t("license.updateTitle")}</h3>
            {update ? (
              <>
                <dl className="status-list">
                  <div><dt>{t("license.updateCurrent")}</dt><dd>{update.currentVersion}</dd></div>
                  <div><dt>{t("license.updateLatest")}</dt><dd>{update.latestVersion}</dd></div>
                  <div><dt>{t("license.updateEligible")}</dt><dd>{update.eligibleLatestVersion}</dd></div>
                  <div><dt>{t("license.updateSupportUntil")}</dt><dd>{update.supportUpdatesUntil}</dd></div>
                </dl>
                <p className={update.canInstallLatest ? "panel-success" : "panel-error"}>
                  {update.canInstallLatest ? t("license.updateEligibleMessage") : t("license.updateNeedRenew")}
                </p>
                <button className="secondary-button" type="button" onClick={renewSupport}>
                  {t("license.updateRenew")}
                </button>
              </>
            ) : null}
          </section>
        </div>

        <section className="pricing-grid">
          {plans.map((plan) => (
            <article className="pricing-card" key={plan.id}>
              <CreditCard size={18} />
              <strong>{plan.name}</strong>
              <span>USD ${plan.priceUsd}</span>
              <small>{plan.cadence}</small>
            </article>
          ))}
        </section>

        <section className="release-readiness-card" aria-label="正式發佈準備矩陣">
          <header>
            <div>
              <h3>正式發佈準備矩陣</h3>
              <p>目前是本機 mock release candidate；正式商業版必須補齊下列 production 條件。</p>
            </div>
            <strong>
              Ready {readinessSummary.ready} · Warning {readinessSummary.warning} · Blocked {readinessSummary.blocked}
            </strong>
          </header>
          <div className="release-readiness-grid">
            {readinessMatrix.map((item) => (
              <article className={`release-readiness-item ${item.status}`} key={item.id}>
                <span>{item.status}</span>
                <strong>{item.label}</strong>
                <small>{item.current}</small>
                <p>{item.nextAction}</p>
              </article>
            ))}
          </div>
        </section>

        {message ? <p className="panel-success">{message}</p> : null}
        {error ? <p className="panel-error">{error}</p> : null}
      </section>
    </div>
  );
}
