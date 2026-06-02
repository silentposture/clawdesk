import { FileUp, FolderLock, Globe2, MonitorUp, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { createUploadItem, type UploadItem } from "../lib/uploads";
import { decideChange, type SandboxPolicy } from "../lib/security";
import { useI18n } from "../lib/i18n";
import { FolderPicker } from "./FolderPicker";
import { Tooltip } from "./Tooltip";

interface SecurityPanelProps {
  policy: SandboxPolicy;
  onPolicyChange: (policy: SandboxPolicy) => void;
  onClose: () => void;
}

export function SecurityPanel({ policy, onPolicyChange, onClose }: SecurityPanelProps): JSX.Element {
  const { t } = useI18n();
  const [sourcePath, setSourcePath] = useState("~/Desktop/report.docx");
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const outsideDecision = decideChange(policy, { kind: "write", target: "~/Desktop/outside.docx" });
  const projectDecision = decideChange(policy, { kind: "upload", target: `${policy.projectFolder}/uploads/report.docx` });

  function addUpload() {
    const item = createUploadItem(policy.projectFolder, sourcePath.trim() || "~/Desktop/report.docx");
    setUploads((current) => [item, ...current].slice(0, 6));
  }

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
      <section className="security-panel" role="dialog" aria-modal="true" aria-labelledby="security-title">
        <header className="provider-header">
          <div>
            <h2 id="security-title">{t("security.title")}</h2>
            <p>{t("security.subtitle")}</p>
          </div>
          <button className="icon-button" type="button" aria-label={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="security-grid">
          <section className="security-card wide">
            <FolderLock size={22} />
            <div>
              <h3>{t("security.sandbox")}</h3>
              <FolderPicker
                label={t("security.projectFolder")}
                value={policy.projectFolder}
                helperText={t("security.projectHelp")}
                onSelect={handleProjectFolderSelect}
              />
              <label>
                <span>{t("security.backupFolder")}</span>
                <input value={policy.backupFolder} onChange={(event) => onPolicyChange({ ...policy, backupFolder: event.target.value })} />
              </label>
            </div>
          </section>

          <section className="security-card">
            <ShieldCheck size={22} />
            <h3>{t("security.rules")}</h3>
            <ul>
              <li>{t("security.outsideRule", { value: outsideDecision.requiresApproval ? t("security.requiresApproval") : t("security.allowed") })}</li>
              <li>{t("security.projectRule", { value: projectDecision.requiresBackup ? t("security.backupFirst") : t("security.runDirectly") })}</li>
              <li>{t("security.deleteRule")}</li>
            </ul>
          </section>

          <section className="security-card">
            <FileUp size={22} />
            <h3>{t("security.upload")}</h3>
            <label>
              <span>{t("security.sourcePath")}</span>
              <input value={sourcePath} onChange={(event) => setSourcePath(event.target.value)} />
            </label>
            <button className="secondary-button" type="button" onClick={addUpload}>
              {t("security.simulateUpload")}
            </button>
          </section>

          <section className="security-card">
            <h3>{t("security.uploadQueue")}</h3>
            <div className="upload-list">
              {uploads.length === 0 ? <p>{t("security.noUploads")}</p> : null}
              {uploads.map((item) => (
                <article key={item.id}>
                  <strong>{item.name}</strong>
                  <span>{item.kind} · {item.sizeLabel}</span>
                  <small>{item.sandboxPath}</small>
                </article>
              ))}
            </div>
          </section>

          <Tooltip text={t("security.internetHelp")}>
            <label className="security-toggle">
              <Globe2 size={19} />
              <span>{t("security.internet")}</span>
              <input type="checkbox" checked={policy.allowInternet} onChange={(event) => onPolicyChange({ ...policy, allowInternet: event.target.checked })} />
            </label>
          </Tooltip>

          <Tooltip text={t("security.screenHelp")}>
            <label className="security-toggle">
              <MonitorUp size={19} />
              <span>{t("security.screen")}</span>
              <input type="checkbox" checked={policy.allowScreenVision} onChange={(event) => onPolicyChange({ ...policy, allowScreenVision: event.target.checked })} />
            </label>
          </Tooltip>
        </div>
      </section>
    </div>
  );
}
