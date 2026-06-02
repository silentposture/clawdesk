import { Gauge, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { defaultContextBudget, type ContextBudget } from "../lib/codingWorkspace";
import { useI18n } from "../lib/i18n";

interface ContextBudgetPanelProps {
  gatewayBaseUrl?: string;
  onClose: () => void;
}

const actionLabelKey: Record<ContextBudget["recommendedAction"], string> = {
  none: "context.action.none",
  compact: "context.action.compact",
  clear: "context.action.clear",
};

export function ContextBudgetPanel({ gatewayBaseUrl, onClose }: ContextBudgetPanelProps): JSX.Element {
  const { t } = useI18n();
  const [budget, setBudget] = useState<ContextBudget>(defaultContextBudget);

  useEffect(() => {
    void load();
  }, [gatewayBaseUrl]);

  async function load() {
    if (!gatewayBaseUrl) return;
    try {
      const response = await fetch(`${gatewayBaseUrl}/context-budget`);
      if (!response.ok) return;
      const payload = (await response.json()) as { budget: ContextBudget };
      setBudget(payload.budget);
    } catch {
      setBudget(defaultContextBudget);
    }
  }

  return (
    <div className="panel-backdrop" role="presentation">
      <section className="context-budget-panel" role="dialog" aria-modal="true" aria-labelledby="context-budget-title">
        <header className="provider-header">
          <div>
            <h2 id="context-budget-title">{t("context.title")}</h2>
            <p>{t("context.subtitle")}</p>
          </div>
          <button className="icon-button" type="button" aria-label={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <section className="context-budget-grid">
          <article className="commercial-card budget-meter-card">
            <Gauge size={28} />
            <h3>{budget.budgetPercent}%</h3>
            <p>{t("context.estimatedTokens", { used: budget.estimatedTokens.toLocaleString(), limit: budget.tokenLimit.toLocaleString() })}</p>
          </article>
          <article className="commercial-card">
            <RotateCcw size={24} />
            <h3>{t(actionLabelKey[budget.recommendedAction])}</h3>
            <p>{budget.note}</p>
          </article>
          <article className="commercial-card">
            <h3>{t("context.messages", { count: budget.messageCount })}</h3>
            <p>{t("context.loadedTools", { value: budget.loadedTools.join(", ") })}</p>
            <p>{t("context.mcp", { value: budget.mcpConnectors.join(", ") })}</p>
          </article>
        </section>
      </section>
    </div>
  );
}
