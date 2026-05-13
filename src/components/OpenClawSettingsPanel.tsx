import { CheckCircle2, ChevronRight, Settings2, SlidersHorizontal, X } from "lucide-react";
import { useMemo, useState } from "react";
import {
  defaultOpenClawSetupProfile,
  openClawSettingSections,
  setupCompletion,
  type OpenClawSetupProfile,
} from "../lib/openclawSettings";
import {
  openClawFeatureParity,
  openClawFeatureParitySnapshot,
  summarizeOpenClawFeatureParity,
} from "../lib/openclawFeatureParity";
import type { SandboxPolicy } from "../lib/security";
import { FolderPicker } from "./FolderPicker";
import { Tooltip } from "./Tooltip";
import { llmProviderCatalog, type ProviderId } from "../lib/providers";

interface OpenClawSettingsPanelProps {
  policy: SandboxPolicy;
  onPolicyChange: (policy: SandboxPolicy) => void;
  onClose: () => void;
}

const goalLabels: Record<OpenClawSetupProfile["goal"], string> = {
  personal: "個人助理",
  office: "辦公文書",
  automation: "自動化工作",
  advanced: "進階自訂",
};

const providerOptions = llmProviderCatalog.map((provider) => ({
  id: provider.id,
  label: provider.shortName,
}));
const providerLabels = Object.fromEntries(providerOptions.map((item) => [item.id, item.label])) as Record<
  ProviderId,
  string
>;

export function OpenClawSettingsPanel({
  policy,
  onPolicyChange,
  onClose,
}: OpenClawSettingsPanelProps): JSX.Element {
  const [profile, setProfile] = useState<OpenClawSetupProfile>({
    ...defaultOpenClawSetupProfile,
    workspaceFolder: policy.projectFolder,
    internetEnabled: policy.allowInternet,
    screenVisionEnabled: policy.allowScreenVision,
  });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState(openClawSettingSections[0].id);
  const [activeParityId, setActiveParityId] = useState(openClawFeatureParity[0].id);

  const activeSection = useMemo(
    () => openClawSettingSections.find((section) => section.id === activeSectionId) ?? openClawSettingSections[0],
    [activeSectionId],
  );
  const completion = setupCompletion(profile);
  const paritySummary = summarizeOpenClawFeatureParity();
  const activeParity =
    openClawFeatureParity.find((item) => item.id === activeParityId) ?? openClawFeatureParity[0];

  function handleWorkspaceFolderSelect(projectFolder: string) {
    const normalized = projectFolder.trim().replace(/\/+$/, "");
    setProfile({
      ...profile,
      workspaceFolder: normalized,
    });
  }

  function saveProfile() {
    onPolicyChange({
      ...policy,
      projectFolder: profile.workspaceFolder,
      backupFolder: `${profile.workspaceFolder.replace(/\/+$/, "")}/.clawdesk-backups`,
      allowInternet: profile.internetEnabled,
      allowScreenVision: profile.screenVisionEnabled,
    });
    onClose();
  }

  return (
    <div className="panel-backdrop" role="presentation">
      <section className="openclaw-settings-panel" role="dialog" aria-modal="true" aria-labelledby="openclaw-settings-title">
        <header className="provider-header">
          <div>
            <h2 id="openclaw-settings-title">OpenClaw 相容設定導引</h2>
            <p>把 OpenClaw-compatible 設定搬到 ClawDesk 桌面端，但先用一般人看得懂的問題帶你完成。</p>
          </div>
          <button className="icon-button" type="button" aria-label="關閉" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="guided-settings-layout">
          <section className="guided-card">
            <div className="completion-ring">
              <CheckCircle2 size={22} />
              <strong>{completion}%</strong>
              <span>設定完成度</span>
            </div>
            <h3>先回答 5 個問題</h3>
            <label>
              <span>主要用途</span>
              <select value={profile.goal} onChange={(event) => setProfile({ ...profile, goal: event.target.value as OpenClawSetupProfile["goal"] })}>
                {Object.entries(goalLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>AI 連線方式</span>
              <select
                value={profile.modelProvider}
                onChange={(event) => setProfile({ ...profile, modelProvider: event.target.value as OpenClawSetupProfile["modelProvider"] })}
              >
                {Object.entries(providerLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <FolderPicker
              label="專案資料夾"
              value={profile.workspaceFolder}
              helperText="一般使用者可直接從資料夾清單選擇專案目錄。"
              onSelect={handleWorkspaceFolderSelect}
            />
            <Tooltip text="開啟後可讓 MCP/Browser 工具查詢網路；任何外部服務仍需個別授權。">
              <label className="setup-toggle">
                <span>允許網際網路功能</span>
                <input
                  type="checkbox"
                  checked={profile.internetEnabled}
                  onChange={(event) => setProfile({ ...profile, internetEnabled: event.target.checked })}
                />
              </label>
            </Tooltip>
            <Tooltip text="讓模型在授權後理解螢幕 GUI 狀態；適合協助操作桌面軟體。">
              <label className="setup-toggle">
                <span>允許螢幕 GUI 視覺辨識</span>
                <input
                  type="checkbox"
                  checked={profile.screenVisionEnabled}
                  onChange={(event) => setProfile({ ...profile, screenVisionEnabled: event.target.checked })}
                />
              </label>
            </Tooltip>
          </section>

          <section className="settings-explainer">
            <header>
              <Settings2 size={20} />
              <div>
                <h3>OpenClaw 設定會被整理成這些區塊</h3>
                <p>左邊是簡單設定；底層仍保留完整 key，未來可匯入/匯出 OpenClaw config。</p>
              </div>
            </header>
            <div className="setting-section-list">
              {openClawSettingSections.map((section) => (
                <button
                  className={section.id === activeSection.id ? "active" : ""}
                  key={section.id}
                  type="button"
                  onClick={() => setActiveSectionId(section.id)}
                >
                  <span>
                    <strong>{section.plainTitle}</strong>
                    <small>{section.title}</small>
                  </span>
                  <ChevronRight size={15} />
                </button>
              ))}
            </div>
          </section>

          <section className="setting-detail-card">
            <span>{activeSection.title}</span>
            <h3>{activeSection.plainTitle}</h3>
            <p>{activeSection.setupQuestion}</p>
            <div className="setting-item-list">
              {activeSection.items
                .filter((item) => advancedOpen || item.audience === "basic")
                .map((item) => (
                  <article key={item.id}>
                    <strong>{item.plainLabel}</strong>
                    <p>{item.description}</p>
                    <small>
                      OpenClaw key：{item.label} · 預設：{item.defaultValue}
                    </small>
                  </article>
                ))}
            </div>
            <button className="secondary-button" type="button" onClick={() => setAdvancedOpen((current) => !current)}>
              <SlidersHorizontal size={15} />
              {advancedOpen ? "隱藏進階設定" : "顯示進階設定"}
            </button>
          </section>

          <section className="setting-detail-card">
            <span>OpenClaw upstream parity</span>
            <h3>功能對標矩陣</h3>
            <p>
              upstream {openClawFeatureParitySnapshot.commit.slice(0, 12)} · partial {paritySummary.partial} · mock {paritySummary.mock} · deferred {paritySummary.deferred}
            </p>
            <div className="setting-section-list parity-section-list">
              {openClawFeatureParity.map((item) => (
                <button
                  className={item.id === activeParity.id ? "active" : ""}
                  key={item.id}
                  type="button"
                  onClick={() => setActiveParityId(item.id)}
                >
                  <span>
                    <strong>{item.domain}</strong>
                    <small>{item.status}</small>
                  </span>
                  <ChevronRight size={15} />
                </button>
              ))}
            </div>
            <article className="parity-detail">
              <strong>{activeParity.domain}</strong>
              <p>{activeParity.difference}</p>
              <small>本機：{activeParity.localSurface}</small>
              <small>上游：{activeParity.upstreamPaths.join(", ")}</small>
              <p>{activeParity.windowsAction}</p>
            </article>
          </section>
        </div>

        <footer className="setup-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            稍後再說
          </button>
          <button className="primary-button" type="button" onClick={saveProfile}>
            套用設定
          </button>
        </footer>
      </section>
    </div>
  );
}
