import { CheckCircle2, ChevronRight, Settings2, SlidersHorizontal, X } from "lucide-react";
import { useMemo, useState } from "react";
import {
  defaultCompatSetupProfile,
  compatSettingSections,
  setupCompletion,
  type CompatSetupProfile,
} from "../lib/compatSettings";
import {
  compatFeatureParity,
  compatFeatureParitySnapshot,
  summarizeCompatFeatureParity,
} from "../lib/compatFeatureParity";
import type { SandboxPolicy } from "../lib/security";
import { FolderPicker } from "./FolderPicker";
import { Tooltip } from "./Tooltip";
import { llmProviderCatalog, type ProviderId } from "../lib/providers";
import { useI18n } from "../lib/i18n";

interface CompatSettingsPanelProps {
  policy: SandboxPolicy;
  onPolicyChange: (policy: SandboxPolicy) => void;
  onClose: () => void;
}

const goalLabelKeys: Record<CompatSetupProfile["goal"], string> = {
  personal: "compatSettings.goal.personal",
  office: "compatSettings.goal.office",
  automation: "compatSettings.goal.automation",
  advanced: "compatSettings.goal.advanced",
};

const providerOptions = llmProviderCatalog.map((provider) => ({
  id: provider.id,
  label: provider.shortName,
}));
const providerLabels = Object.fromEntries(providerOptions.map((item) => [item.id, item.label])) as Record<
  ProviderId,
  string
>;

export function CompatSettingsPanel({
  policy,
  onPolicyChange,
  onClose,
}: CompatSettingsPanelProps): JSX.Element {
  const { t } = useI18n();
  const [profile, setProfile] = useState<CompatSetupProfile>({
    ...defaultCompatSetupProfile,
    workspaceFolder: policy.projectFolder,
    internetEnabled: policy.allowInternet,
    screenVisionEnabled: policy.allowScreenVision,
  });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState(compatSettingSections[0].id);
  const [activeParityId, setActiveParityId] = useState(compatFeatureParity[0].id);

  const activeSection = useMemo(
    () => compatSettingSections.find((section) => section.id === activeSectionId) ?? compatSettingSections[0],
    [activeSectionId],
  );
  const completion = setupCompletion(profile);
  const paritySummary = summarizeCompatFeatureParity();
  const activeParity =
    compatFeatureParity.find((item) => item.id === activeParityId) ?? compatFeatureParity[0];

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
      <section className="compat-settings-panel" role="dialog" aria-modal="true" aria-labelledby="compat-settings-title">
        <header className="provider-header">
          <div>
            <h2 id="compat-settings-title">{t("compatSettings.title")}</h2>
            <p>{t("compatSettings.subtitle")}</p>
          </div>
          <button className="icon-button" type="button" aria-label={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="guided-settings-layout">
          <section className="guided-card">
            <div className="completion-ring">
              <CheckCircle2 size={22} />
              <strong>{completion}%</strong>
              <span>{t("compatSettings.completion")}</span>
            </div>
            <h3>{t("compatSettings.quickQuestions")}</h3>
            <label>
              <span>{t("compatSettings.goal")}</span>
              <select value={profile.goal} onChange={(event) => setProfile({ ...profile, goal: event.target.value as CompatSetupProfile["goal"] })}>
                {Object.entries(goalLabelKeys).map(([value, labelKey]) => (
                  <option key={value} value={value}>
                    {t(labelKey)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t("compatSettings.provider")}</span>
              <select
                value={profile.modelProvider}
                onChange={(event) => setProfile({ ...profile, modelProvider: event.target.value as CompatSetupProfile["modelProvider"] })}
              >
                {Object.entries(providerLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <FolderPicker
              label={t("compatSettings.projectFolder")}
              value={profile.workspaceFolder}
              helperText={t("compatSettings.projectFolderHelp")}
              onSelect={handleWorkspaceFolderSelect}
            />
            <Tooltip text={t("compatSettings.internetHelp")}>
              <label className="setup-toggle">
                <span>{t("compatSettings.internet")}</span>
                <input
                  type="checkbox"
                  checked={profile.internetEnabled}
                  onChange={(event) => setProfile({ ...profile, internetEnabled: event.target.checked })}
                />
              </label>
            </Tooltip>
            <Tooltip text={t("compatSettings.screenHelp")}>
              <label className="setup-toggle">
                <span>{t("compatSettings.screen")}</span>
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
                <h3>{t("compatSettings.sectionsTitle")}</h3>
                <p>{t("compatSettings.sectionsSubtitle")}</p>
              </div>
            </header>
            <div className="setting-section-list">
              {compatSettingSections.map((section) => (
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
                      {t("compatSettings.keyDefault", { key: item.label, value: item.defaultValue })}
                    </small>
                  </article>
                ))}
            </div>
            <button className="secondary-button" type="button" onClick={() => setAdvancedOpen((current) => !current)}>
              <SlidersHorizontal size={15} />
              {advancedOpen ? t("compatSettings.hideAdvanced") : t("compatSettings.showAdvanced")}
            </button>
          </section>

          <section className="setting-detail-card">
            <span>{t("compatSettings.parityLabel")}</span>
            <h3>{t("compatSettings.parityTitle")}</h3>
            <p>
              {t("compatSettings.paritySummary", {
                commit: compatFeatureParitySnapshot.commit.slice(0, 12),
                partial: paritySummary.partial,
                mock: paritySummary.mock,
                deferred: paritySummary.deferred,
              })}
            </p>
            <div className="setting-section-list parity-section-list">
              {compatFeatureParity.map((item) => (
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
              <dl className="status-list">
                <div>
                  <dt>{t("compatSettings.status")}</dt>
                  <dd>{activeParity.status}</dd>
                </div>
                <div>
                  <dt>{t("compatSettings.risk")}</dt>
                  <dd>{activeParity.riskLevel ?? t("compatSettings.uncategorized")}</dd>
                </div>
                <div>
                  <dt>{t("compatSettings.milestone")}</dt>
                  <dd>{activeParity.targetMilestone ?? t("compatSettings.unscheduled")}</dd>
                </div>
                <div>
                  <dt>{t("compatSettings.endpoint")}</dt>
                  <dd>{activeParity.testEndpoint || t("compatSettings.endpointMissing")}</dd>
                </div>
              </dl>
              <small>{t("compatSettings.local", { value: activeParity.localSurface })}</small>
              <small>{t("compatSettings.upstream", { value: activeParity.upstreamPaths.join(", ") })}</small>
              <p>{activeParity.windowsAction}</p>
            </article>
          </section>
        </div>

        <footer className="setup-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            {t("compatSettings.later")}
          </button>
          <button className="primary-button" type="button" onClick={saveProfile}>
            {t("compatSettings.apply")}
          </button>
        </footer>
      </section>
    </div>
  );
}
