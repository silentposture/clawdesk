import { ShieldAlert, ShieldCheck, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  defaultSafetyPolicyRules,
  summarizeSafetyPolicy,
  type SafetyPolicyRule,
} from "../lib/safetyPolicy";
import { useI18n } from "../lib/i18n";

interface SafetyQueuePanelProps {
  gatewayBaseUrl?: string;
  onClose: () => void;
}

interface SafetyPolicyPayload {
  rules: SafetyPolicyRule[];
  queue?: Array<{ id: string; action: string; riskLevel: SafetyPolicyRule["riskLevel"]; status: string; note?: string }>;
}

export function SafetyQueuePanel({ gatewayBaseUrl, onClose }: SafetyQueuePanelProps): JSX.Element {
  const { t } = useI18n();
  const [rules, setRules] = useState<SafetyPolicyRule[]>(defaultSafetyPolicyRules);
  const [queue, setQueue] = useState<SafetyPolicyPayload["queue"]>([]);

  useEffect(() => {
    void load();
  }, [gatewayBaseUrl]);

  async function load() {
    if (!gatewayBaseUrl) return;
    try {
      const response = await fetch(`${gatewayBaseUrl}/safety-policy`);
      if (!response.ok) return;
      const payload = (await response.json()) as SafetyPolicyPayload;
      setRules(payload.rules);
      setQueue(payload.queue ?? []);
    } catch {
      setRules(defaultSafetyPolicyRules);
      setQueue([]);
    }
  }

  async function decide(itemId: string, decision: "approve" | "reject") {
    if (!gatewayBaseUrl) return;
    const response = await fetch(`${gatewayBaseUrl}/safety-queue/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: itemId, decision }),
    });
    if (!response.ok) return;
    const payload = (await response.json()) as { queue: SafetyPolicyPayload["queue"] };
    setQueue(payload.queue ?? []);
  }

  const summary = useMemo(() => summarizeSafetyPolicy(rules), [rules]);

  return (
    <div className="panel-backdrop" role="presentation">
      <section className="safety-queue-panel" role="dialog" aria-modal="true" aria-labelledby="safety-queue-title">
        <header className="provider-header">
          <div>
            <h2 id="safety-queue-title">{t("safety.title")}</h2>
            <p>{t("safety.subtitle")}</p>
          </div>
          <button className="icon-button" type="button" aria-label={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <section className="comparison-summary">
          <article className="commercial-card">
            <ShieldAlert size={24} />
            <h3>{t("safety.approvalRules", { count: summary.requiresApproval })}</h3>
            <p>{t("safety.highBlocked", { high: summary.high, blocked: summary.blocked })}</p>
          </article>
          <article className="commercial-card">
            <ShieldCheck size={24} />
            <h3>{t("safety.queueItems", { count: queue?.length ?? 0 })}</h3>
            <p>{t("safety.mockAudit")}</p>
          </article>
        </section>

        <section className="safety-rule-grid">
          {rules.map((rule) => (
            <article className="safety-rule-card" key={rule.id}>
              <header>
                <strong>{rule.label}</strong>
                <span className={`risk-pill risk-${rule.riskLevel}`}>{rule.riskLevel}</span>
              </header>
              <p>{rule.description}</p>
              <small>
                {t("safety.categoryApproval", {
                  category: rule.auditCategory,
                  approval: rule.requiresApproval ? t("common.required") : t("common.notRequired"),
                })}
              </small>
              {rule.denyPaths.length > 0 ? <small>{t("safety.deny", { value: rule.denyPaths.join(", ") })}</small> : null}
              {rule.allowCommands.length > 0 ? <small>{t("safety.allow", { value: rule.allowCommands.join(", ") })}</small> : null}
            </article>
          ))}
        </section>

        {queue && queue.length > 0 ? (
          <section className="adapter-list">
            {queue.map((item) => (
              <div key={item.id}>
                <dt>{item.action}</dt>
                <dd>{item.riskLevel} · {item.status}{item.note ? ` · ${item.note}` : ""}</dd>
                <button className="secondary-button" type="button" onClick={() => decide(item.id, "approve")}>{t("common.approve")}</button>
                <button className="secondary-button" type="button" onClick={() => decide(item.id, "reject")}>{t("common.reject")}</button>
              </div>
            ))}
          </section>
        ) : null}
      </section>
    </div>
  );
}
