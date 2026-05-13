import { Database, Pin, Scissors, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ContextStatus, MemoryItem } from "../lib/memory";
import { Tooltip } from "./Tooltip";

interface MemoryPanelProps {
  gatewayBaseUrl?: string;
  onClose: () => void;
}

export function MemoryPanel({ gatewayBaseUrl, onClose }: MemoryPanelProps): JSX.Element {
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [context, setContext] = useState<ContextStatus>();
  const [title, setTitle] = useState("新的長期記憶");
  const [body, setBody] = useState("使用者偏好：以繁體中文回答。");

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
            <h2 id="memory-title">記憶與 Context</h2>
            <p>SQLite mock 管索引與權限，Markdown/YAML mock 保留可讀記憶；長對話透過 rolling summary 壓縮。</p>
          </div>
          <button className="icon-button" type="button" aria-label="關閉" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="commercial-grid">
          <section className="commercial-card">
            <Database size={23} />
            <h3>長期記憶</h3>
            <label>標題<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
            <label>內容<textarea value={body} onChange={(event) => setBody(event.target.value)} /></label>
            <button className="primary-button" type="button" onClick={addMemory}>
              <Pin size={16} />
              新增釘選記憶
            </button>
            <div className="stack-list">
              {items.map((item) => (
                <article key={item.id}>
                  <strong>{item.title}</strong>
                  <small>{item.agentId} · {item.source} · {item.shared ? "共享" : "隔離"}</small>
                  <p>{item.body}</p>
                </article>
              ))}
            </div>
          </section>
          <section className="commercial-card">
            <Scissors size={23} />
            <h3>Context 壓縮</h3>
            {context ? (
              <>
                <dl className="status-list">
                  <div><dt>模型上限</dt><dd>{context.modelContextLimit.toLocaleString()} tokens</dd></div>
                  <div><dt>估算使用</dt><dd>{context.estimatedTokens.toLocaleString()} tokens</dd></div>
                  <div><dt>壓縮比</dt><dd>{context.compressionRatio}</dd></div>
                </dl>
                <p>{context.rollingSummary}</p>
                <ul>{context.pinnedFacts.map((fact) => <li key={fact}>{fact}</li>)}</ul>
              </>
            ) : null}
            <Tooltip text="保留釘選事實，把舊對話轉成摘要，降低 Context 佔用。">
              <button className="secondary-button" type="button" onClick={compress}>
                壓縮 Context
              </button>
            </Tooltip>
          </section>
        </div>
      </section>
    </div>
  );
}
