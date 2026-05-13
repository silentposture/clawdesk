import { FileUp, FolderLock, Globe2, MonitorUp, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { createUploadItem, type UploadItem } from "../lib/uploads";
import { decideChange, type SandboxPolicy } from "../lib/security";
import { FolderPicker } from "./FolderPicker";
import { Tooltip } from "./Tooltip";

interface SecurityPanelProps {
  policy: SandboxPolicy;
  onPolicyChange: (policy: SandboxPolicy) => void;
  onClose: () => void;
}

export function SecurityPanel({ policy, onPolicyChange, onClose }: SecurityPanelProps): JSX.Element {
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
            <h2 id="security-title">沙盒、上傳與能力權限</h2>
            <p>本區設定資料夾邊界、多模態檔案上傳、網際網路連線與螢幕 GUI 視覺辨識。</p>
          </div>
          <button className="icon-button" type="button" aria-label="關閉" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="security-grid">
          <section className="security-card wide">
            <FolderLock size={22} />
            <div>
              <h3>專案沙盒</h3>
              <FolderPicker
                label="專案資料夾"
                value={policy.projectFolder}
                helperText="請先在此目錄建立專案，外部改動都會先要求授權。"
                onSelect={handleProjectFolderSelect}
              />
              <label>
                <span>備份資料夾</span>
                <input value={policy.backupFolder} onChange={(event) => onPolicyChange({ ...policy, backupFolder: event.target.value })} />
              </label>
            </div>
          </section>

          <section className="security-card">
            <ShieldCheck size={22} />
            <h3>安全規則</h3>
            <ul>
              <li>超出專案資料夾：{outsideDecision.requiresApproval ? "需要人工授權" : "允許"}</li>
              <li>專案內改動：{projectDecision.requiresBackup ? "先備份再改動" : "直接執行"}</li>
              <li>刪除動作：不主動刪除</li>
            </ul>
          </section>

          <section className="security-card">
            <FileUp size={22} />
            <h3>多模態上傳</h3>
            <label>
              <span>來源檔案路徑</span>
              <input value={sourcePath} onChange={(event) => setSourcePath(event.target.value)} />
            </label>
            <button className="secondary-button" type="button" onClick={addUpload}>
              模擬上傳並複製到沙盒
            </button>
          </section>

          <section className="security-card">
            <h3>上傳佇列</h3>
            <div className="upload-list">
              {uploads.length === 0 ? <p>尚未加入檔案。</p> : null}
              {uploads.map((item) => (
                <article key={item.id}>
                  <strong>{item.name}</strong>
                  <span>{item.kind} · {item.sizeLabel}</span>
                  <small>{item.sandboxPath}</small>
                </article>
              ))}
            </div>
          </section>

          <Tooltip text="關閉後，所有網路查詢、Google/Microsoft 服務與外部 MCP 都要先重新授權。">
            <label className="security-toggle">
              <Globe2 size={19} />
              <span>網際網路連線</span>
              <input type="checkbox" checked={policy.allowInternet} onChange={(event) => onPolicyChange({ ...policy, allowInternet: event.target.checked })} />
            </label>
          </Tooltip>

          <Tooltip text="啟用後，模型可以在授權後讀取螢幕 GUI 影像摘要，用來協助操作與判讀畫面。">
            <label className="security-toggle">
              <MonitorUp size={19} />
              <span>螢幕 GUI 視覺辨識</span>
              <input type="checkbox" checked={policy.allowScreenVision} onChange={(event) => onPolicyChange({ ...policy, allowScreenVision: event.target.checked })} />
            </label>
          </Tooltip>
        </div>
      </section>
    </div>
  );
}
