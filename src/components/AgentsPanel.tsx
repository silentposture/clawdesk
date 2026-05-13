import { Database, HardDrive, HelpCircle, Image, Library, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AgentProfile } from "../lib/agents";
import { Tooltip } from "./Tooltip";

interface AgentsPanelProps {
  gatewayBaseUrl?: string;
  onClose: () => void;
}

interface KnowledgeSource {
  id: string;
  type: string;
  name: string;
  description: string;
  provider: string;
}

export function AgentsPanel({ gatewayBaseUrl, onClose }: AgentsPanelProps): JSX.Element {
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [knowledgeSources, setKnowledgeSources] = useState<KnowledgeSource[]>([]);
  const [bindings, setBindings] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    void load();
  }, [gatewayBaseUrl]);

  async function load() {
    if (!gatewayBaseUrl) return;
    const [agentsResponse, sourcesResponse] = await Promise.all([
      fetch(`${gatewayBaseUrl}/agents`),
      fetch(`${gatewayBaseUrl}/knowledge/sources`),
    ]);

    const agentPayload = agentsResponse.ok ? ((await agentsResponse.json()) as { agents: AgentProfile[] }) : { agents: [] };
    if (agentsResponse.ok) {
      setAgents(agentPayload.agents);
    }

    if (sourcesResponse.ok) {
      const sourcePayload = (await sourcesResponse.json()) as { sources: KnowledgeSource[] };
      setKnowledgeSources(sourcePayload.sources);
      const bindingEntries = await Promise.all(
        agentPayload.agents.map(async (agent) => {
          const response = await fetch(`${gatewayBaseUrl}/agents/${agent.id}/knowledge-sources`);
          if (!response.ok) return [agent.id, agent.knowledgeBaseIds] as const;
          const payload = (await response.json()) as { knowledgeBaseIds: string[] };
          return [agent.id, Array.isArray(payload.knowledgeBaseIds) ? payload.knowledgeBaseIds : agent.knowledgeBaseIds] as const;
        }),
      );
      setBindings(Object.fromEntries(bindingEntries));
    } else {
      setBindings((prev) => {
        const fallback = { ...prev };
        for (const agent of agentPayload.agents) {
          fallback[agent.id] = agent.knowledgeBaseIds;
        }
        return fallback;
      });
    }
  }

  async function createAgent() {
    if (!gatewayBaseUrl) return;
    const response = await fetch(`${gatewayBaseUrl}/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "商務助理", role: "協助銷售、報價、信件草稿與會議追蹤。", memoryScope: "private" }),
    });
    if (!response.ok) return;
    await load();
  }

  async function createKnowledgeSource() {
    if (!gatewayBaseUrl) return;
    const name = window.prompt("請輸入企業知識來源名稱（例如：國際專案文件庫）");
    if (!name) return;
    const type = window.prompt("請輸入知識來源類型：cloud-drive / database / image-corpus", "cloud-drive");
    if (!type || !["cloud-drive", "database", "image-corpus"].includes(type)) {
      setMessage("新增失敗：類型需為 cloud-drive、database、image-corpus 之一。");
      return;
    }
    const description = window.prompt("請輸入簡短描述", `${name} 的模擬知識來源`) ?? "";
    const provider = window.prompt("請輸入提供者", "Enterprise mock provider") ?? "";
    const response = await fetch(`${gatewayBaseUrl}/knowledge/sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, type, description, provider }),
    });
    if (!response.ok) {
      setMessage("建立知識來源失敗");
      return;
    }
    const payload = (await response.json()) as { source: KnowledgeSource; sources: KnowledgeSource[] };
    setKnowledgeSources(payload.sources);
    setMessage(`已建立知識來源：「${payload.source.name}」`);
  }

  async function setAgentKnowledge(agentId: string, knowledgeBaseIds: string[]) {
    if (!gatewayBaseUrl) return;
    const response = await fetch(`${gatewayBaseUrl}/agents/${agentId}/knowledge-sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ knowledgeBaseIds }),
    });
    if (!response.ok) {
      setMessage("更新知識綁定失敗");
      return;
    }
    const payload = (await response.json()) as { knowledgeBaseIds: string[] };
    setBindings((current) => ({ ...current, [agentId]: payload.knowledgeBaseIds }));
    setMessage("已更新 Agent 知識綁定。");
  }

  function toggleKnowledge(agentId: string, sourceId: string, enabled: boolean) {
    const current = new Set(bindings[agentId] ?? []);
    if (enabled) {
      current.add(sourceId);
    } else {
      current.delete(sourceId);
    }
    void setAgentKnowledge(agentId, Array.from(current));
  }

  async function addKnowledge(agentId: string) {
    if (!gatewayBaseUrl) return;
    const response = await fetch(`${gatewayBaseUrl}/agents/${agentId}/knowledge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "專屬知識", body: "此知識預設只給該 Agent 使用。", shared: false }),
    });
    if (response.ok) setMessage("已新增 Agent 專屬知識；未勾選共享前不跨 Agent 使用。");
  }

  function renderIcon(sourceType: string) {
    if (sourceType === "cloud-drive") return <HardDrive size={14} />;
    if (sourceType === "database") return <Database size={14} />;
    if (sourceType === "image-corpus") return <Image size={14} />;
    return <HardDrive size={14} />;
  }

  function renderTypeLabel(sourceType: string) {
    if (sourceType === "cloud-drive") return "雲端硬碟";
    if (sourceType === "database") return "資料庫";
    if (sourceType === "image-corpus") return "影像庫";
    return sourceType;
  }

  return (
    <div className="panel-backdrop" role="presentation">
      <section className="agents-panel" role="dialog" aria-modal="true" aria-labelledby="agents-title">
        <header className="provider-header">
          <div>
            <h2 id="agents-title">Agent 與知識庫</h2>
            <p>每個 Agent 可有獨立模型、工具權限、工作區、知識庫、記憶範圍與學習設定；企業可模擬雲端硬碟、資料庫、影像庫。</p>
          </div>
          <button className="icon-button" type="button" aria-label="關閉" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="panel-actions">
          <Tooltip text="建立新的角色化 Agent，預設採私有記憶與預演模式。">
            <button className="primary-button" type="button" onClick={createAgent}>
              <Plus size={16} />
              新增 Agent
            </button>
          </Tooltip>
          <Tooltip text="建立企業知識來源，支援雲端硬碟 / 資料庫 / 影像庫類型。">
            <button className="secondary-button" type="button" onClick={createKnowledgeSource}>
              <HelpCircle size={16} />
              建立知識來源
            </button>
          </Tooltip>
        </div>
        <section className="agent-grid">
          {agents.map((agent) => (
            <article className="agent-card" key={agent.id}>
              <h3>{agent.name}</h3>
              <p>{agent.role}</p>
              <small>{agent.model} · {agent.memoryScope} · {agent.learningMode}</small>
              <div className="agent-knowledge-summary">
                <strong>已綁定企業知識源：</strong>
                <span>
                  {(bindings[agent.id] ?? agent.knowledgeBaseIds)
                    .map((sourceId) => knowledgeSources.find((item) => item.id === sourceId)?.name)
                    .filter(Boolean)
                    .join("、") || "未綁定"}
                </span>
              </div>
              <ul className="chip-row">
                {(bindings[agent.id] ?? agent.knowledgeBaseIds).map((sourceId) => {
                  const source = knowledgeSources.find((item) => item.id === sourceId);
                  if (!source) return null;
                  return (
                    <li className="agent-knowledge-item" key={`${agent.id}-${source.id}`}>
                      {renderIcon(source.type)}
                      <span>
                        {source.name}
                        <small>（{renderTypeLabel(source.type)}）</small>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <details className="knowledge-editor">
                <summary>調整知識綁定</summary>
                <div className="knowledge-editor-grid">
                  {knowledgeSources.map((source) => (
                    <label key={`${agent.id}-${source.id}`} className="knowledge-editor-item">
                      <span>
                        {renderIcon(source.type)}
                        <div>
                          <strong>{source.name}</strong>
                          <small>{renderTypeLabel(source.type)} · {source.provider}</small>
                        </div>
                      </span>
                      <input
                        type="checkbox"
                        checked={(bindings[agent.id] ?? agent.knowledgeBaseIds).includes(source.id)}
                        onChange={(event) => {
                          toggleKnowledge(agent.id, source.id, event.currentTarget.checked);
                        }}
                      />
                    </label>
                  ))}
                </div>
              </details>
              <button className="secondary-button" type="button" onClick={() => void addKnowledge(agent.id)}>
                <Library size={15} />
                加入專屬知識
              </button>
              <div className="chip-row">
                {agent.toolPermissions.map((permission) => <span key={permission}>{permission}</span>)}
              </div>
            </article>
          ))}
        </section>
        {message ? <p className="panel-success">{message}</p> : null}
      </section>
    </div>
  );
}
