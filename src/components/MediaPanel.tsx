import { FileText, Film, ImageIcon, Mic, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  defaultMediaCapabilities,
  defaultMediaPolicy,
  mediaCapabilitySummary,
  mediaKindLabel,
  type MediaCapability,
  type MediaPolicy,
} from "../lib/media";
import { useI18n } from "../lib/i18n";
import { Tooltip } from "./Tooltip";

interface MediaPanelProps {
  gatewayBaseUrl?: string;
  onClose: () => void;
}

const iconByKind = {
  video: Film,
  audio: Mic,
  image: ImageIcon,
  "text-log": FileText,
};

export function MediaPanel({ gatewayBaseUrl, onClose }: MediaPanelProps): JSX.Element {
  const { t } = useI18n();
  const [capabilities, setCapabilities] = useState<MediaCapability[]>(defaultMediaCapabilities);
  const [policy, setPolicy] = useState<MediaPolicy>(defaultMediaPolicy);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void loadCapabilities();
  }, [gatewayBaseUrl]);

  async function loadCapabilities() {
    if (!gatewayBaseUrl) return;
    setError(undefined);
    try {
      const response = await fetch(`${gatewayBaseUrl}/media/capabilities`);
      if (!response.ok) throw new Error("bad response");
      const payload = (await response.json()) as { capabilities: MediaCapability[]; policy: MediaPolicy };
      setCapabilities(payload.capabilities);
      setPolicy(payload.policy);
    } catch {
      setError(t("media.loadError"));
    }
  }

  return (
    <div className="panel-backdrop" role="presentation">
      <section className="media-panel" role="dialog" aria-modal="true" aria-labelledby="media-title">
        <header className="provider-header">
          <div>
            <h2 id="media-title">{t("media.title")}</h2>
            <p>{t("media.subtitle")}</p>
          </div>
          <button className="icon-button" type="button" aria-label={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="media-layout">
          <section className="media-policy-card">
            <ShieldCheck size={22} />
            <div>
              <h3>{t("media.policyTitle")}</h3>
              <p>{t("media.policyBody")}</p>
              <div className="media-policy-grid">
                <span>{t("media.videoLimit", { value: policy.maxVideoMinutes })}</span>
                <span>{t("media.audioLimit", { value: policy.maxAudioMinutes })}</span>
                <span>{t("media.textLogLimit", { value: policy.maxTextLogMb })}</span>
                <span>{policy.preferHardwareAcceleration ? t("media.hardware") : t("media.cpu")}</span>
              </div>
            </div>
          </section>

          <section className="media-capability-grid">
            {capabilities.map((capability) => {
              const Icon = iconByKind[capability.kind];
              return (
                <article className="media-card" key={capability.id}>
                  <div>
                    <Icon size={21} />
                    <span>{mediaKindLabel(capability.kind)}</span>
                  </div>
                  <h3>{capability.name}</h3>
                  <p>{mediaCapabilitySummary(capability)}</p>
                  <small>{capability.engine}</small>
                  <Tooltip text={capability.notes}>
                    <button className="secondary-button" type="button">
                      {t("media.viewLimits")}
                    </button>
                  </Tooltip>
                  <span className="media-limit">{capability.maxInputLabel}</span>
                </article>
              );
            })}
          </section>
        </div>

        {error ? <p className="panel-error">{error}</p> : null}
      </section>
    </div>
  );
}
