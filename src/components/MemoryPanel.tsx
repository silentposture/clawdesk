import { Database, Pin, Scissors, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ContextStatus, MemoryItem } from "../lib/memory";
import { useI18n } from "../lib/i18n";
import { Tooltip } from "./Tooltip";

interface MemoryPanelProps {
  gatewayBaseUrl?: string;
  onClose: () => void;
}

export function MemoryPanel({ gatewayBaseUrl, onClose }: MemoryPanelProps): JSX.Element {
  const { t } = useI18n();
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [context, setContext] = useState<ContextStatus>();
  const [title, setTitle] = useState(() => t("memory.defaultTitle"));
  const [body, setBody] = useState(() => t("memory.defaultBody"));

  useEffect(() => {
    void load();
  }, [gatewayBaseUrl]);

  async function load() {
    if (!gatewayBaseUrl) return;
    const [memoryResponse, contextResponse] = await Promise.all([
      fetch(`${gatewayBaseUrl}/memory/profile`),
      fetch(`${gatewayBaseUrl}/context/status`),
    ]);
    if (memoryResponse.ok) setItems(((await memoryResponse.json()) as { items: MemoryItem[] }).items);
    if (contextResponse.ok) setContext((await contextResponse.json()) as ContextStatus);
  }

  async function addMemory() {
    if (!gatewayBaseUrl) return;
    const response = await fetch(`${gatewayBaseUrl}/memory/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: "personal-assistant", title, body, pinned: true, shared: true }),
    });
    if (response.ok) setItems(((await response.json()) as { items: MemoryItem[] }).items);
  }

  async function compress() {
    if (!gatewayBaseUrl) return;
    const response = await fetch(`${gatewayBaseUrl}/context/compress`, { method: "POST" });
    if (response.ok) setContext((await response.json()) as ContextStatus);
  }

  return (
    <div className="panel-backdrop" role="presentation">
      <section className="memory-panel" role="dialog" aria-modal="true" aria-labelledby="memory-title">
        <header className="provider-header">
          <div>
            <h2 id="memory-title">{t("memory.title")}</h2>
            <p>{t("memory.subtitle")}</p>
          </div>
          <button className="icon-button" type="button" aria-label={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="commercial-grid">
          <section className="commercial-card">
            <Database size={23} />
            <h3>{t("memory.longTerm")}</h3>
            <label>{t("memory.fieldTitle")}<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
            <label>{t("memory.fieldBody")}<textarea value={body} onChange={(event) => setBody(event.target.value)} /></label>
            <button className="primary-button" type="button" onClick={addMemory}>
              <Pin size={16} />
              {t("memory.addPinned")}
            </button>
            <div className="stack-list">
              {items.map((item) => (
                <article key={item.id}>
                  <strong>{item.title}</strong>
                  <small>{item.agentId} · {item.source} · {item.shared ? t("memory.shared") : t("memory.isolated")}</small>
                  <p>{item.body}</p>
                </article>
              ))}
            </div>
          </section>
          <section className="commercial-card">
            <Scissors size={23} />
            <h3>{t("memory.contextCompression")}</h3>
            {context ? (
              <>
                <dl className="status-list">
                  <div><dt>{t("memory.modelLimit")}</dt><dd>{context.modelContextLimit.toLocaleString()} tokens</dd></div>
                  <div><dt>{t("memory.estimatedUse")}</dt><dd>{context.estimatedTokens.toLocaleString()} tokens</dd></div>
                  <div><dt>{t("memory.compressionRatio")}</dt><dd>{context.compressionRatio}</dd></div>
                </dl>
                <p>{context.rollingSummary}</p>
                <ul>{context.pinnedFacts.map((fact) => <li key={fact}>{fact}</li>)}</ul>
              </>
            ) : null}
            <Tooltip text={t("memory.compressTooltip")}>
              <button className="secondary-button" type="button" onClick={compress}>
                {t("memory.compress")}
              </button>
            </Tooltip>
          </section>
        </div>
      </section>
    </div>
  );
}
