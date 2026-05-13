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
      setError("無法讀取多媒體能力清單，暫時顯示本機預設。");
    }
  }

  return (
    <div className="panel-backdrop" role="presentation">
      <section className="media-panel" role="dialog" aria-modal="true" aria-labelledby="media-title">
        <header className="provider-header">
          <div>
            <h2 id="media-title">多媒體與文字記錄能力</h2>
            <p>桌面端自帶本機影片、音訊、圖片與文字記錄處理邊界；檔案仍先複製到專案沙盒再作業。</p>
          </div>
          <button className="icon-button" type="button" aria-label="關閉" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="media-layout">
          <section className="media-policy-card">
            <ShieldCheck size={22} />
            <div>
              <h3>本機處理原則</h3>
              <p>資料預設留在本機，不自動上傳外部服務；需要模型或雲端處理時會先要求授權。</p>
              <div className="media-policy-grid">
                <span>影片上限：{policy.maxVideoMinutes} 分鐘</span>
                <span>音訊上限：{policy.maxAudioMinutes} 分鐘</span>
                <span>文字記錄：{policy.maxTextLogMb} MB</span>
                <span>{policy.preferHardwareAcceleration ? "優先 Windows 硬體加速" : "優先 CPU 省電模式"}</span>
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
                      查看限制
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
