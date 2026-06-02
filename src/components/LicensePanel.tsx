import { CheckCircle2, CreditCard, KeyRound, RefreshCw, Undo2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { betaPricingPlans, canInstallLatestVersion, createFreeStatus, type LicenseStatus, type PricingPlan } from "../lib/licensing";
import { useI18n } from "../lib/i18n";
import {
  activateNaviaLicense,
  createNaviaLicenseGatewayClient,
  createTauriNaviaLicenseCacheStore,
  deactivateNaviaLicense,
  getCurrentNaviaMachineIdentity,
  mapNaviaLicenseToClawDeskStatus,
  refreshNaviaLicense,
  runNaviaLicenseStartupCheck,
} from "../lib/naviaLicenseClient";
import {
  buildReleaseReadinessMatrix,
  defaultMockCandidateReadiness,
  summarizeReleaseReadiness,
} from "../lib/releaseReadiness";
import { Tooltip } from "./Tooltip";

interface LicensePanelProps {
  gatewayBaseUrl?: string;
  identityEmail?: string;
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

const CLAWDESK_LICENSE_PRODUCT_KEY = "clawdesk";
const CLAWDESK_APP_VERSION = "0.1.0";
const CLAWDESK_APP_RELEASE_DATE_UTC = "2026-05-16T00:00:00.000Z";

export function LicensePanel({ gatewayBaseUrl, identityEmail, onClose }: LicensePanelProps): JSX.Element {
  const { t } = useI18n();
  const [status, setStatus] = useState<LicenseStatus>();
  const [plans] = useState<PricingPlan[]>(betaPricingPlans);
  const [update, setUpdate] = useState<UpdateInfo>();
  const [licenseKey, setLicenseKey] = useState("CLWD-BETA-PRO1-2026");
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const readinessMatrix = buildReleaseReadinessMatrix(defaultMockCandidateReadiness);
  const readinessSummary = summarizeReleaseReadiness(readinessMatrix);
  const statusHint = status ? buildStatusHint(status, t) : null;

  useEffect(() => {
    void load();
  }, [gatewayBaseUrl, identityEmail]);

  async function load() {
    setError(undefined);
    if (!gatewayBaseUrl) {
      setError(t("license.noGateway"));
      return;
    }
    try {
      const service = createLicenseService(gatewayBaseUrl);
      const state = await runNaviaLicenseStartupCheck(service);
      const nextStatus =
        state.cache && state.local
          ? mapNaviaLicenseToClawDeskStatus(state.cache, state.local, state.remote)
          : createFreeStatus("NO_LICENSE_CACHE");
      setStatus(nextStatus);
      setUpdate(buildUpdateInfo(nextStatus));
    } catch {
      setError(t("license.error"));
      const fallback = createFreeStatus("LICENSE_LOAD_FAILED");
      setStatus(fallback);
      setUpdate(buildUpdateInfo(fallback));
    }
  }

  async function activate() {
    if (!gatewayBaseUrl) {
      setError(t("license.noGateway"));
      return;
    }
    if (!identityEmail) {
      setError(t("license.identityRequired"));
      return;
    }
    setMessage(undefined);
    setError(undefined);
    try {
      const machine = await getCurrentNaviaMachineIdentity();
      await activateNaviaLicense(createLicenseService(gatewayBaseUrl), {
        orderNo: licenseKey.trim(),
        email: identityEmail,
        hwid: machine.hwid,
        instanceId: machine.instanceId,
      });
      setMessage(t("license.activateSuccess"));
      await load();
    } catch (error) {
      setError(resolveLicenseActionError(error, t, "license.activateError"));
    }
  }

  async function refreshEntitlement() {
    if (!gatewayBaseUrl) {
      setError(t("license.noGateway"));
      return;
    }
    setMessage(undefined);
    setError(undefined);
    try {
      const updated = await refreshNaviaLicense(createLicenseService(gatewayBaseUrl));
      if (!updated) {
        setError(t("license.validationError"));
        return;
      }
      setMessage(t("license.refreshSuccess"));
      await load();
    } catch (error) {
      setError(resolveLicenseActionError(error, t, "license.validationError"));
    }
  }

  async function deactivateCurrentDevice() {
    if (!gatewayBaseUrl) {
      setError(t("license.noGateway"));
      return;
    }
    setMessage(undefined);
    setError(undefined);
    try {
      const deleted = await deactivateNaviaLicense(createLicenseService(gatewayBaseUrl));
      if (!deleted) {
        setError(t("license.validationError"));
        return;
      }
      const nextStatus = createFreeStatus("DEVICE_DEACTIVATED");
      setStatus(nextStatus);
      setUpdate(buildUpdateInfo(nextStatus));
      setMessage(t("license.deactivateSuccess"));
    } catch (error) {
      setError(resolveLicenseActionError(error, t, "license.validationError"));
    }
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
            <h3>{t("license.lemonTitle")}</h3>
            <label>
              {t("license.keyLabel")}
              <input value={licenseKey} onChange={(event) => setLicenseKey(event.target.value)} />
            </label>
            <div className="panel-actions">
              <Tooltip text={t("license.activationTooltip")}>
                <button className="primary-button" type="button" onClick={activate}>
                  <CheckCircle2 size={16} />
                  {t("license.activate")}
                </button>
              </Tooltip>
              <Tooltip text={t("license.refreshTooltip")}>
                <button className="secondary-button" type="button" onClick={refreshEntitlement}>
                  <RefreshCw size={16} />
                  {t("license.refresh")}
                </button>
              </Tooltip>
              <Tooltip text={t("license.deactivateTooltip")}>
                <button className="secondary-button" type="button" onClick={deactivateCurrentDevice}>
                  <Undo2 size={16} />
                  {t("license.deactivate")}
                </button>
              </Tooltip>
            </div>
            {status ? (
              <>
                <dl className="status-list">
                  <div><dt>{t("license.paymentProvider")}</dt><dd>{status.paymentProvider}</dd></div>
                  <div><dt>{t("license.licenseProvider")}</dt><dd>{status.licenseProvider}</dd></div>
                  <div><dt>{t("license.featurePlan")}</dt><dd>{status.plan}</dd></div>
                  <div><dt>{t("license.featureStatus")}</dt><dd>{status.status}</dd></div>
                  <div><dt>{t("license.featureDeviceLimit")}</dt><dd>{status.deviceLimit}</dd></div>
                  <div><dt>{t("license.featureMachines")}</dt><dd>{t("license.machinesCount", { count: status.machines.length })}</dd></div>
                  <div><dt>{t("license.entitlement")}</dt><dd>{status.entitlement?.status ?? t("license.none")}</dd></div>
                  <div><dt>{t("license.licenseHash")}</dt><dd>{status.entitlement?.licenseKeyHash ?? t("license.none")}</dd></div>
                  <div><dt>{t("license.offlineGrace")}</dt><dd>{status.offlineGraceUntil ?? status.entitlement?.graceUntil ?? t("license.none")}</dd></div>
                  <div><dt>{t("license.featureValidationCode")}</dt><dd>{status.lastValidationCode ?? t("license.none")}</dd></div>
                </dl>
                {statusHint ? <p className={statusHint.level === "ok" ? "panel-success" : "panel-error"}>{statusHint.text}</p> : null}
              </>
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

        <section className="release-readiness-card" aria-label={t("license.readinessLabel")}>
          <header>
            <div>
              <h3>{t("license.readinessTitle")}</h3>
              <p>{t("license.readinessSubtitle")}</p>
            </div>
            <strong>
              {t("license.readinessSummary", {
                ready: readinessSummary.ready,
                warning: readinessSummary.warning,
                blocked: readinessSummary.blocked,
              })}
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

function createLicenseService(gatewayBaseUrl: string) {
  return {
    gateway: createNaviaLicenseGatewayClient(gatewayBaseUrl),
    store: createTauriNaviaLicenseCacheStore(),
    productKey: CLAWDESK_LICENSE_PRODUCT_KEY,
    appVersion: CLAWDESK_APP_VERSION,
    appReleaseDateUtc: CLAWDESK_APP_RELEASE_DATE_UTC,
  };
}

function buildUpdateInfo(status: LicenseStatus): UpdateInfo {
  return {
    currentVersion: CLAWDESK_APP_VERSION,
    latestVersion: CLAWDESK_APP_VERSION,
    eligibleLatestVersion: status.eligibleLatestVersion,
    supportUpdatesUntil: status.supportUpdatesUntil,
    canInstallLatest: canInstallLatestVersion(status, CLAWDESK_APP_RELEASE_DATE_UTC),
    downloadUrl: null,
    releaseNotes: [],
    requiresRenewal: !canInstallLatestVersion(status, CLAWDESK_APP_RELEASE_DATE_UTC),
  };
}

function buildStatusHint(status: LicenseStatus, t: (key: string, vars?: Record<string, string | number>) => string): { level: "ok" | "error"; text: string } | null {
  switch (status.status) {
    case "active":
      return { level: "ok", text: t("license.state.active") };
    case "trial":
      return { level: "ok", text: t("license.state.trial") };
    case "offline-grace":
      return { level: "error", text: t("license.state.offlineGrace") };
    case "expired":
      return { level: "error", text: t("license.state.expired") };
    case "revoked":
      return { level: "error", text: t("license.state.revoked") };
    case "tampered":
      return { level: "error", text: t("license.state.tampered") };
    case "safe-mode":
      return { level: "error", text: t("license.state.safeMode") };
    default:
      return null;
  }
}

function resolveLicenseActionError(
  error: unknown,
  t: (key: string, vars?: Record<string, string | number>) => string,
  fallbackKey: string,
): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message.includes("device_limit_exceeded")) {
    return t("license.error.deviceLimitExceeded");
  }
  if (message.includes("revoked")) {
    return t("license.error.revoked");
  }
  if (message.includes("expired")) {
    return t("license.error.expired");
  }
  if (message.includes("email_mismatch")) {
    return t("license.error.emailMismatch");
  }
  return t(fallbackKey);
}
