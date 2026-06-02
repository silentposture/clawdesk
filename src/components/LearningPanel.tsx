import { BrainCircuit, ListChecks, MousePointerClick, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { defaultLearningSession, type LearningSession, type ObservedActionKind } from "../lib/learning";
import { useI18n } from "../lib/i18n";
import { Tooltip } from "./Tooltip";

interface LearningPanelProps {
  gatewayBaseUrl?: string;
  onClose: () => void;
}

const demoActions: Array<{
  app: string;
  kind: ObservedActionKind;
  description: string;
  target: string;
  risk: "low" | "medium" | "high";
}> = [
  {
    app: "File Explorer",
    kind: "file-action",
    description: "把來源檔案複製到專案 uploads",
    target: "~/Downloads/report.pdf",
    risk: "medium",
  },
  {
    app: "Microsoft Word",
    kind: "open-app",
    description: "開啟 Word 並建立摘要草稿",
    target: "~/ClawDesk Project/uploads/report.pdf",
    risk: "medium",
  },
  {
    app: "Browser",
    kind: "browser",
    description: "查詢指定網站並保留來源連結",
    target: "https://example.com",
    risk: "low",
  },
];

export function LearningPanel({ gatewayBaseUrl, onClose }: LearningPanelProps): JSX.Element {
  const { t } = useI18n();
  const [session, setSession] = useState<LearningSession>(defaultLearningSession);
  const [demoIndex, setDemoIndex] = useState(0);
  const [draftName, setDraftName] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    void loadSession();
  }, [gatewayBaseUrl]);

  async function loadSession() {
    if (!gatewayBaseUrl) return;
    try {
      const response = await fetch(`${gatewayBaseUrl}/learning/session`);
      if (!response.ok) throw new Error("bad response");
      setSession((await response.json()) as LearningSession);
    } catch {
      setError(t("learning.loadError"));
    }
  }

  async function startLearning() {
    if (!gatewayBaseUrl) return;
    setError(undefined);
    setDraftName(undefined);
    try {
      const response = await fetch(`${gatewayBaseUrl}/learning/start`, { method: "POST" });
      if (!response.ok) throw new Error("bad response");
      setSession((await response.json()) as LearningSession);
      setDemoIndex(0);
    } catch {
      setError(t("learning.startError"));
    }
  }

  async function observeNextAction() {
    if (!gatewayBaseUrl) return;
    const action = demoActions[demoIndex % demoActions.length];
    try {
      const response = await fetch(`${gatewayBaseUrl}/learning/observe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      if (!response.ok) throw new Error("bad response");
      setSession((await response.json()) as LearningSession);
      setDemoIndex((current) => current + 1);
    } catch {
      setError(t("learning.observeError"));
    }
  }

  async function stopLearning() {
    if (!gatewayBaseUrl) return;
    try {
      const response = await fetch(`${gatewayBaseUrl}/learning/stop`, { method: "POST" });
      if (!response.ok) throw new Error("bad response");
      const payload = (await response.json()) as { session: LearningSession; workflow?: { name: string } };
      setSession(payload.session);
      setDraftName(payload.workflow?.name);
    } catch {
      setError(t("learning.stopError"));
    }
  }

  function statusLabel() {
    if (session.status === "recording") return t("learning.status.recording");
    if (session.status === "draft-ready") return t("learning.status.draftReady");
    return t("learning.status.idle");
  }

  return (
    <div className="panel-backdrop" role="presentation">
      <section className="learning-panel" role="dialog" aria-modal="true" aria-labelledby="learning-title">
        <header className="provider-header">
          <div>
            <h2 id="learning-title">{t("learning.title")}</h2>
            <p>{t("learning.subtitle")}</p>
          </div>
          <button className="icon-button" type="button" aria-label={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="learning-layout">
          <section className="learning-card">
            <BrainCircuit size={24} />
            <h3>{t("learning.status", { status: statusLabel() })}</h3>
            <ul>
              <li>{t("learning.rule.start")}</li>
              <li>{t("learning.rule.private")}</li>
              <li>{t("learning.rule.screen")}</li>
              <li>{t("learning.rule.draft")}</li>
            </ul>
            <div className="learning-actions">
              <Tooltip text={t("learning.startTooltip")}>
                <button className="primary-button" type="button" disabled={session.status === "recording"} onClick={startLearning}>
                  <MousePointerClick size={16} />
                  {t("learning.start")}
                </button>
              </Tooltip>
              <button className="secondary-button" type="button" disabled={session.status !== "recording"} onClick={observeNextAction}>
                {t("learning.observe")}
              </button>
              <button className="secondary-button" type="button" disabled={session.status !== "recording"} onClick={stopLearning}>
                <Square size={14} />
                {t("learning.stop")}
              </button>
            </div>
          </section>

          <section className="learning-card">
            <ListChecks size={24} />
            <h3>{t("learning.steps")}</h3>
            {session.actions.length === 0 ? <p className="empty-note">{t("learning.noActions")}</p> : null}
            <div className="learning-step-list">
              {session.actions.map((action, index) => (
                <article key={action.id}>
                  <span>{t("learning.step", { index: index + 1 })}</span>
                  <strong>{action.description}</strong>
                  <small>{action.app} · {action.kind} · {action.target}</small>
                </article>
              ))}
            </div>
            {draftName ? <p className="panel-success">{t("learning.created", { name: draftName })}</p> : null}
            {error ? <p className="panel-error">{error}</p> : null}
          </section>
        </div>
      </section>
    </div>
  );
}
