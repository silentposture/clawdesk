import { AtSign, CheckCircle2, ChevronLeft, ChevronRight, Hash, Mail, MessageCircle, Send, ShieldCheck, Smartphone, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  buildChannelDraft,
  channelGuideCompletion,
  channelPreview,
  type ChannelDraft,
  type ChannelKind,
  type ChannelPreview,
  type CommunicationChannel,
} from "../lib/channels";
import { useI18n } from "../lib/i18n";
import { Tooltip } from "./Tooltip";

interface ChannelsPanelProps {
  gatewayBaseUrl?: string;
  onClose: () => void;
}

const channelIcons: Record<ChannelKind, typeof MessageCircle> = {
  telegram: Send,
  discord: Hash,
  whatsapp: Smartphone,
  slack: Hash,
  teams: MessageCircle,
  gmail: Mail,
  line: MessageCircle,
  matrix: AtSign,
};

export function ChannelsPanel({ gatewayBaseUrl, onClose }: ChannelsPanelProps): JSX.Element {
  const { t } = useI18n();
  const [channels, setChannels] = useState<CommunicationChannel[]>([]);
  const [selectedId, setSelectedId] = useState<ChannelKind>("telegram");
  const [allowlist, setAllowlist] = useState("@me, @team");
  const [activeGuideStep, setActiveGuideStep] = useState(0);
  const [completedGuideSteps, setCompletedGuideSteps] = useState<Record<ChannelKind, string[]>>({
    telegram: [],
    discord: [],
    whatsapp: [],
    slack: [],
    teams: [],
    gmail: [],
    line: [],
    matrix: [],
  });
  const [preview, setPreview] = useState<ChannelPreview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const statusLabel: Record<CommunicationChannel["status"], string> = {
    disabled: t("channel.status.disabled"),
    "needs-setup": t("channel.status.needs-setup"),
    configured: t("channel.status.configured"),
    connected: t("channel.status.connected"),
  };

  const selected = useMemo(() => channels.find((channel) => channel.id === selectedId), [channels, selectedId]);

  useEffect(() => {
    void loadChannels();
  }, [gatewayBaseUrl]);

  async function loadChannels() {
    if (!gatewayBaseUrl) return;
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(`${gatewayBaseUrl}/channels`);
      if (!response.ok) throw new Error("bad response");
      const payload = (await response.json()) as { channels: CommunicationChannel[] };
      setChannels(payload.channels);
      setSelectedId(payload.channels[0]?.id ?? "telegram");
    } catch {
      setError("Failed to load channel list.");
    } finally {
      setBusy(false);
    }
  }

  async function configureChannel(enabled: boolean) {
    if (!gatewayBaseUrl || !selected) return;
    const draft = buildChannelDraft(selected, allowlist, enabled);
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(`${gatewayBaseUrl}/channels/configure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!response.ok) throw new Error("bad response");
      setPreview((await response.json()) as ChannelPreview);
      await loadChannels();
    } catch {
      setError("Channel setup failed.");
      setBusy(false);
    }
  }

  async function testChannel() {
    if (!gatewayBaseUrl || !selected) return;
    const draft: ChannelDraft = buildChannelDraft(selected, allowlist, true);
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(`${gatewayBaseUrl}/channels/test-message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!response.ok) throw new Error("bad response");
      setPreview((await response.json()) as ChannelPreview);
    } catch {
      setError("Channel preview failed.");
    } finally {
      setBusy(false);
    }
  }

  function completeCurrentStep() {
    if (!selected) return;
    const step = selected.guideSteps[activeGuideStep];
    if (!step) return;
    setCompletedGuideSteps((current) => ({
      ...current,
      [selected.id]: Array.from(new Set([...current[selected.id], step.id])),
    }));
    setActiveGuideStep((current) => Math.min(current + 1, selected.guideSteps.length - 1));
  }

  const guideStep = selected?.guideSteps[activeGuideStep];
  const completion = selected ? channelGuideCompletion(selected, completedGuideSteps[selected.id]) : 0;

  return (
    <div className="panel-backdrop" role="presentation">
      <section className="channels-panel" role="dialog" aria-modal="true" aria-labelledby="channels-title">
        <header className="provider-header">
          <div>
            <h2 id="channels-title">{t("channel.title")}</h2>
            <p>{t("channel.subtitle")}</p>
          </div>
          <button className="icon-button" type="button" aria-label={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="channels-layout">
          <aside className="channel-list">
            {channels.map((channel) => {
              const Icon = channelIcons[channel.id];
              return (
                <button
                  className={channel.id === selectedId ? "active" : ""}
                  key={channel.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(channel.id);
                    setPreview(undefined);
                    setActiveGuideStep(0);
                  }}
                >
                  <Icon size={17} />
                  <span>
                    <strong>{channel.name}</strong>
                    <small>{statusLabel[channel.status]} · {t("app.permission.risk")} {channel.risk}</small>
                  </span>
                </button>
              );
            })}
          </aside>

          <section className="channel-detail">
            {selected ? (
              <>
                <div className="channel-summary">
                  <ShieldCheck size={22} />
                  <div>
                    <span>{statusLabel[selected.status]} · stream {selected.streamMode}</span>
                    <h3>{selected.name}</h3>
                    <p>{selected.description}</p>
                  </div>
                </div>

                <div className="channel-setup">
                  <div className="channel-guide">
                    <div className="guide-progress">
                      <CheckCircle2 size={18} />
                      <span>{t("channel.guideIndex", { current: completion, total: 100 })}%</span>
                    </div>
                    {guideStep ? (
                      <article className="guide-step-card">
                        <span>
                          {t("channel.guideIndex", { current: activeGuideStep + 1, total: selected.guideSteps.length })}
                        </span>
                        <h4>{guideStep.title}</h4>
                        <p>{guideStep.instruction}</p>
                        <small>{guideStep.helperText}</small>
                        <strong>{guideStep.userAction}</strong>
                      </article>
                    ) : null}
                    <div className="guide-actions">
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={activeGuideStep === 0}
                        onClick={() => setActiveGuideStep((current) => Math.max(0, current - 1))}
                      >
                        <ChevronLeft size={15} />
                        {t("channel.previous")}
                      </button>
                      <button className="secondary-button" type="button" onClick={completeCurrentStep}>
                        {t("channel.next")}
                        <ChevronRight size={15} />
                      </button>
                    </div>
                  </div>

                  <label>
                    <span>{selected.allowlistLabel}</span>
                    <input value={allowlist} onChange={(event) => setAllowlist(event.target.value)} />
                    <small>{selected.setupHint}</small>
                  </label>
                  <div className="required-fields">
                    {selected.requiredFields.map((field) => (
                      <span key={field}>{field}</span>
                    ))}
                  </div>
                </div>

                <div className="channel-actions">
                  <Tooltip text="Save settings in MVP mode first; tokens/webhooks are wired in production gateway.">
                    <button className="primary-button" type="button" disabled={busy} onClick={() => configureChannel(true)}>
                      {t("channel.setupComplete")}
                    </button>
                  </Tooltip>
                  <button className="secondary-button" type="button" disabled={busy} onClick={testChannel}>
                    {t("channel.testPreview")}
                  </button>
                  <button className="secondary-button" type="button" disabled={busy} onClick={() => configureChannel(false)}>
                    {t("channel.disable")}
                  </button>
                </div>

                {preview ? (
                  <div className="channel-preview">
                    <span>{t("channel.preview")}</span>
                    <strong>{preview.title}</strong>
                    <p>{preview.summary}</p>
                    <small>{preview.requiresApproval ? t("channel.reviewNeeded") : t("channel.lowRisk")}</small>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="empty-note">{t("channel.empty")}</p>
            )}
            {error ? <p className="panel-error">{error}</p> : null}
          </section>
        </div>
      </section>
    </div>
  );
}
