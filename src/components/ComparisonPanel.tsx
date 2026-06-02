import { BarChart3, CheckCircle2, Scale, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  productComparisonItems,
  summarizeProductComparison,
  type ProductComparisonItem,
} from "../lib/productComparison";
import { useI18n } from "../lib/i18n";

interface ComparisonPanelProps {
  gatewayBaseUrl?: string;
  onClose: () => void;
}

const PRODUCT_LABELS = {
  openClaw: "上游參考",
  claudeCowork: "Claude Cowork",
  claudeCode: "Claude Code",
  clawDesk: "ClawDesk",
};

export function ComparisonPanel({ gatewayBaseUrl, onClose }: ComparisonPanelProps): JSX.Element {
  const { t } = useI18n();
  const [items, setItems] = useState<ProductComparisonItem[]>(productComparisonItems);

  useEffect(() => {
    void load();
  }, [gatewayBaseUrl]);

  async function load() {
    if (!gatewayBaseUrl) return;
    try {
      const response = await fetch(`${gatewayBaseUrl}/product-comparison`);
      if (!response.ok) return;
      const payload = (await response.json()) as { items: ProductComparisonItem[] };
      setItems(payload.items);
    } catch {
      setItems(productComparisonItems);
    }
  }

  const summary = useMemo(() => summarizeProductComparison(items), [items]);

  return (
    <div className="panel-backdrop" role="presentation">
      <section className="comparison-panel" role="dialog" aria-modal="true" aria-labelledby="comparison-title">
        <header className="provider-header">
          <div>
            <h2 id="comparison-title">{t("comparison.title")}</h2>
            <p>{t("comparison.subtitle")}</p>
          </div>
          <button className="icon-button" type="button" aria-label={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <section className="comparison-summary">
          <article className="commercial-card">
            <Scale size={24} />
            <h3>{t("comparison.totalDomains", { count: summary.total })}</h3>
            <p>{t("comparison.focus")}</p>
          </article>
          <article className="commercial-card">
            <BarChart3 size={24} />
            <h3>P0 · {summary.p0}</h3>
            <p>{t("comparison.p0")}</p>
          </article>
          <article className="commercial-card">
            <CheckCircle2 size={24} />
            <h3>P1 · {summary.p1}</h3>
            <p>{t("comparison.p1")}</p>
          </article>
        </section>

        <section className="comparison-grid">
          {items.map((item) => (
            <article className="comparison-card" key={item.domain}>
              <header>
                <div>
                  <strong>{item.domain}</strong>
                  <span className={`priority-pill priority-${item.priority}`}>{item.priority.toUpperCase()}</span>
                </div>
                <p>{item.gap}</p>
              </header>
              <dl className="comparison-list">
                <div>
                  <dt>{PRODUCT_LABELS.openClaw}</dt>
                  <dd>{item.openClaw}</dd>
                </div>
                <div>
                  <dt>{PRODUCT_LABELS.claudeCowork}</dt>
                  <dd>{item.claudeCowork}</dd>
                </div>
                <div>
                  <dt>{PRODUCT_LABELS.claudeCode}</dt>
                  <dd>{item.claudeCode}</dd>
                </div>
                <div>
                  <dt>{PRODUCT_LABELS.clawDesk}</dt>
                  <dd>{item.clawDesk}</dd>
                </div>
              </dl>
            </article>
          ))}
        </section>
      </section>
    </div>
  );
}
