import { BrainCircuit, ListChecks, MousePointerClick, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { defaultLearningSession, type LearningSession, type ObservedActionKind } from "../lib/learning";
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
      setError("無法讀取學習模式狀態。");
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
      setError("無法啟動學習模式。");
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
      setError("無法加入觀察步驟，請確認學習模式已啟動。");
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
      setError("無法停止學習模式或建立草稿。");
    }
  }

  return (
    <div className="panel-backdrop" role="presentation">
      <section className="learning-panel" role="dialog" aria-modal="true" aria-labelledby="learning-title">
        <header className="provider-header">
          <div>
            <h2 id="learning-title">學習模式與工作流拆解</h2>
            <p>觀察人類一般操作，拆成可審核步驟，再建立自動化工作流草稿；不記錄密碼，不直接執行。</p>
          </div>
          <button className="icon-button" type="button" aria-label="關閉" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="learning-layout">
          <section className="learning-card">
            <BrainCircuit size={24} />
            <h3>目前狀態：{session.status === "recording" ? "正在觀察" : session.status === "draft-ready" ? "草稿已建立" : "尚未啟用"}</h3>
            <ul>
              <li>必須人工按下開始，才會觀察操作。</li>
              <li>密碼、token、付款資料與私密欄位不記錄。</li>
              <li>螢幕影像只做授權後摘要，不保存原始畫面。</li>
              <li>停止後只產生工作流草稿，啟用前仍需人工確認。</li>
            </ul>
            <div className="learning-actions">
              <Tooltip text="開始觀察一般操作，將點擊、開啟 app、檔案動作拆成步驟。">
                <button className="primary-button" type="button" disabled={session.status === "recording"} onClick={startLearning}>
                  <MousePointerClick size={16} />
                  開始學習
                </button>
              </Tooltip>
              <button className="secondary-button" type="button" disabled={session.status !== "recording"} onClick={observeNextAction}>
                加入示範步驟
              </button>
              <button className="secondary-button" type="button" disabled={session.status !== "recording"} onClick={stopLearning}>
                <Square size={14} />
                停止並建立草稿
              </button>
            </div>
          </section>

          <section className="learning-card">
            <ListChecks size={24} />
            <h3>已拆解步驟</h3>
            {session.actions.length === 0 ? <p className="empty-note">尚未觀察到操作。</p> : null}
            <div className="learning-step-list">
              {session.actions.map((action, index) => (
                <article key={action.id}>
                  <span>步驟 {index + 1}</span>
                  <strong>{action.description}</strong>
                  <small>{action.app} · {action.kind} · {action.target}</small>
                </article>
              ))}
            </div>
            {draftName ? <p className="panel-success">已建立：{draftName}</p> : null}
            {error ? <p className="panel-error">{error}</p> : null}
          </section>
        </div>
      </section>
    </div>
  );
}
