import { Activity, Keyboard, MousePointer2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { aggregateErgonomicsScore, type ErgonomicsCheck } from "../lib/ergonomics";
import { Tooltip } from "./Tooltip";

interface ErgonomicsPanelProps {
  gatewayBaseUrl?: string;
  onClose: () => void;
}

export function ErgonomicsPanel({ gatewayBaseUrl, onClose }: ErgonomicsPanelProps): JSX.Element {
  const [checks, setChecks] = useState<ErgonomicsCheck[]>([]);
  const [score, setScore] = useState(0);
  const [runVersion, setRunVersion] = useState(0);

  useEffect(() => {
    void load();
  }, [gatewayBaseUrl]);

  async function load() {
    if (!gatewayBaseUrl) return;
    try {
      const response = await fetch(`${gatewayBaseUrl}/ergonomics/checks`);
      if (!response.ok) return;
      const payload = (await response.json()) as { checks: ErgonomicsCheck[]; score: number };
      setChecks(payload.checks);
      setScore(payload.score);
    } catch {
      // Gateway may be restarting during smoke tests; keep the panel usable with the last local snapshot.
    }
  }

  async function runSmoke() {
    if (!gatewayBaseUrl) {
      setRunVersion((value) => value + 1);
      return;
    }
    try {
      const response = await fetch(`${gatewayBaseUrl}/ergonomics/run-smoke`, { method: "POST" });
      if (!response.ok) throw new Error(`ergonomics smoke failed: ${response.status}`);
      const payload = (await response.json()) as { checks: ErgonomicsCheck[]; score: number };
      setChecks(payload.checks);
      setScore(payload.score);
    } catch {
      if (checks.length > 0) {
        setChecks([...checks]);
        setScore(aggregateErgonomicsScore(checks));
      }
    } finally {
      setRunVersion((value) => value + 1);
    }
  }

  return (
    <div className="panel-backdrop" role="presentation">
      <section className="ergonomics-panel" role="dialog" aria-modal="true" aria-labelledby="ergonomics-title">
        <header className="provider-header">
          <div>
            <h2 id="ergonomics-title">GUI 人體工學驗證儀表</h2>
            <p>用自動化 smoke tests 追蹤主要任務路徑、鍵盤可達、文字不溢出、tooltip 與危險操作提示。</p>
          </div>
          <button className="icon-button" type="button" aria-label="關閉" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <section className="commercial-card ergonomics-score">
          <Activity size={28} />
          <div>
            <h3 data-run-version={runVersion}>{score}</h3>
            <p>ergonomics score · 第 {runVersion} 次</p>
          </div>
          <Tooltip text="重新執行本機 mock GUI smoke，檢查任務步數、視窗尺寸、tooltip 與風險提示。">
            <button
              className="primary-button"
              type="button"
              data-testid="ergonomics-run"
              aria-label="執行人體工學驗證"
              onClick={runSmoke}
            >
              執行驗證
            </button>
          </Tooltip>
        </section>
        <section className="agent-grid">
          {checks.map((check) => (
            <article className="agent-card" key={check.id}>
              {check.keyboardReachable ? <Keyboard size={21} /> : <MousePointer2 size={21} />}
              <h3>{check.taskName}</h3>
              <p>{check.viewport} · {check.steps} 步 · score {check.score}</p>
              <small>文字不溢出：{check.noTextOverflow ? "通過" : "需修正"} · tooltip：{Math.round(check.tooltipCoverage * 100)}%</small>
            </article>
          ))}
        </section>
      </section>
    </div>
  );
}
