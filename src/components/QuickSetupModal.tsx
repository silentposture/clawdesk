import { FolderLock, Globe2, KeyRound, MonitorUp, UploadCloud, X } from "lucide-react";
import type { SandboxPolicy } from "../lib/security";
import { useI18n } from "../lib/i18n";
import { FolderPicker } from "./FolderPicker";
import { Tooltip } from "./Tooltip";

interface QuickSetupModalProps {
  policy: SandboxPolicy;
  onPolicyChange: (policy: SandboxPolicy) => void;
  onOpenLicense?: () => void;
  onClose: () => void;
}

export function QuickSetupModal({ policy, onPolicyChange, onOpenLicense, onClose }: QuickSetupModalProps): JSX.Element {
  const { t } = useI18n();

  function handleProjectFolderSelect(projectFolder: string) {
    const normalized = projectFolder.trim().replace(/\/+$/, "");
    onPolicyChange({
      ...policy,
      projectFolder: normalized,
      backupFolder: `${normalized}/.clawdesk-backups`,
    });
  }

  return (
    <div className="panel-backdrop" role="presentation">
      <section className="quick-setup" role="dialog" aria-modal="true" aria-labelledby="quick-setup-title">
        <header className="provider-header">
          <div>
            <h2 id="quick-setup-title">{t("app.quickSetup.title")}</h2>
            <p>{t("app.quickSetup.description")}</p>
          </div>
          <button className="icon-button" type="button" aria-label={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="setup-grid">
          <FolderPicker
            label={t("app.quickSetup.labelProjectFolder")}
            value={policy.projectFolder}
            helperText={t("app.quickSetup.noteUpload")}
            onSelect={handleProjectFolderSelect}
          />

          <label className="setup-field">
            <span>{t("app.quickSetup.labelBackupFolder")}</span>
            <input
              value={policy.backupFolder}
              onChange={(event) => onPolicyChange({ ...policy, backupFolder: event.target.value })}
            />
            <small>{t("app.quickSetup.noteSandbox")}</small>
          </label>

          <div className="setup-card">
            <FolderLock size={22} />
            <strong>{t("app.quickSetup.noteSandbox")}</strong>
            <p>{t("app.quickSetup.noteSandbox")}</p>
          </div>

          <div className="setup-card">
            <UploadCloud size={22} />
            <strong>{t("app.quickSetup.labelProjectFolder")}</strong>
            <p>{t("app.quickSetup.noteUpload")}</p>
          </div>

          <div className="setup-card">
            <KeyRound size={22} />
            <strong>{t("app.quickSetup.licenseTitle")}</strong>
            <p>{t("app.quickSetup.licenseBody")}</p>
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                onClose();
                onOpenLicense?.();
              }}
            >
              {t("app.quickSetup.openLicense")}
            </button>
          </div>

          <Tooltip text={t("tooltip.projectPolicy")}>
            <label className="setup-toggle">
              <Globe2 size={19} />
              <span>{t("app.quickSetup.labelInternet")}</span>
              <input
                type="checkbox"
                checked={policy.allowInternet}
                onChange={(event) => onPolicyChange({ ...policy, allowInternet: event.target.checked })}
              />
            </label>
          </Tooltip>

          <Tooltip text={t("tooltip.projectPolicy")}>
            <label className="setup-toggle">
              <MonitorUp size={19} />
              <span>{t("app.quickSetup.labelScreen")}</span>
              <input
                type="checkbox"
                checked={policy.allowScreenVision}
                onChange={(event) => onPolicyChange({ ...policy, allowScreenVision: event.target.checked })}
              />
            </label>
          </Tooltip>
        </div>

        <footer className="setup-actions">
          <button className="primary-button" type="button" onClick={onClose}>
            {t("app.quickSetup.done")}
          </button>
        </footer>
      </section>
    </div>
  );
}
