import { Activity, Keyboard, MousePointer2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { aggregateErgonomicsScore, type ErgonomicsCheck } from "../lib/ergonomics";
import { useI18n } from "../lib/i18n";
import { Tooltip } from "./Tooltip";

interface ErgonomicsPanelProps {
  gatewayBaseUrl?: string;
  onClose: () => void;
}

export function ErgonomicsPanel({ gatewayBaseUrl, onClose }: ErgonomicsPanelProps): JSX.Element {
  const { t } = useI18n();
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
            <h2 id="ergonomics-title">{t("ergonomics.title")}</h2>
            <p>{t("ergonomics.subtitle")}</p>
          </div>
          <button className="icon-button" type="button" aria-label={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <section className="commercial-card ergonomics-score">
          <Activity size={28} />
          <div>
            <h3 data-run-version={runVersion}>{score}</h3>
            <p>{t("ergonomics.score", { run: runVersion })}</p>
          </div>
          <Tooltip text={t("ergonomics.runTooltip")}>
            <button
              className="primary-button"
              type="button"
              data-testid="ergonomics-run"
              aria-label={t("ergonomics.run")}
              onClick={runSmoke}
            >
              {t("ergonomics.run")}
            </button>
          </Tooltip>
        </section>
        <section className="agent-grid">
          {checks.map((check) => (
            <article className="agent-card" key={check.id}>
              {check.keyboardReachable ? <Keyboard size={21} /> : <MousePointer2 size={21} />}
              <h3>{check.taskName}</h3>
              <p>{t("ergonomics.taskSummary", { viewport: check.viewport, steps: check.steps, score: check.score })}</p>
              <small>
                {t("ergonomics.overflowTooltip", {
                  status: check.noTextOverflow ? t("common.pass") : t("common.needsFix"),
                  coverage: Math.round(check.tooltipCoverage * 100),
                })}
              </small>
            </article>
          ))}
        </section>
      </section>
    </div>
  );
}
