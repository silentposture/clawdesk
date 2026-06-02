import { Database, HardDrive, HelpCircle, Image, Library, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AgentProfile } from "../lib/agents";
import { useI18n } from "../lib/i18n";
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
  const { t } = useI18n();
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
      body: JSON.stringify({ name: t("agents.defaultName"), role: t("agents.defaultRole"), memoryScope: "private" }),
    });
    if (!response.ok) return;
    await load();
  }

  async function createKnowledgeSource() {
    if (!gatewayBaseUrl) return;
    const name = window.prompt(t("agents.prompt.name"));
    if (!name) return;
    const type = window.prompt(t("agents.prompt.type"), "cloud-drive");
    if (!type || !["cloud-drive", "database", "image-corpus"].includes(type)) {
      setMessage(t("agents.message.invalidType"));
      return;
    }
    const description = window.prompt(t("agents.prompt.description"), t("agents.prompt.descriptionDefault", { name })) ?? "";
    const provider = window.prompt(t("agents.prompt.provider"), "Enterprise mock provider") ?? "";
    const response = await fetch(`${gatewayBaseUrl}/knowledge/sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, type, description, provider }),
    });
    if (!response.ok) {
      setMessage(t("agents.message.createFailed"));
      return;
    }
    const payload = (await response.json()) as { source: KnowledgeSource; sources: KnowledgeSource[] };
    setKnowledgeSources(payload.sources);
    setMessage(t("agents.message.created", { name: payload.source.name }));
  }

  async function setAgentKnowledge(agentId: string, knowledgeBaseIds: string[]) {
    if (!gatewayBaseUrl) return;
    const response = await fetch(`${gatewayBaseUrl}/agents/${agentId}/knowledge-sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ knowledgeBaseIds }),
    });
    if (!response.ok) {
      setMessage(t("agents.message.bindFailed"));
      return;
    }
    const payload = (await response.json()) as { knowledgeBaseIds: string[] };
    setBindings((current) => ({ ...current, [agentId]: payload.knowledgeBaseIds }));
    setMessage(t("agents.message.bindUpdated"));
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
      body: JSON.stringify({ title: t("agents.privateKnowledgeTitle"), body: t("agents.privateKnowledgeBody"), shared: false }),
    });
    if (response.ok) setMessage(t("agents.message.privateKnowledgeAdded"));
  }

  function renderIcon(sourceType: string) {
    if (sourceType === "cloud-drive") return <HardDrive size={14} />;
    if (sourceType === "database") return <Database size={14} />;
    if (sourceType === "image-corpus") return <Image size={14} />;
    return <HardDrive size={14} />;
  }

  function renderTypeLabel(sourceType: string) {
    if (sourceType === "cloud-drive") return t("agents.type.cloudDrive");
    if (sourceType === "database") return t("agents.type.database");
    if (sourceType === "image-corpus") return t("agents.type.imageCorpus");
    return sourceType;
  }

  return (
    <div className="panel-backdrop" role="presentation">
      <section className="agents-panel" role="dialog" aria-modal="true" aria-labelledby="agents-title">
        <header className="provider-header">
          <div>
            <h2 id="agents-title">{t("agents.title")}</h2>
            <p>{t("agents.subtitle")}</p>
          </div>
          <button className="icon-button" type="button" aria-label={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="panel-actions">
          <Tooltip text={t("agents.createTooltip")}>
            <button className="primary-button" type="button" onClick={createAgent}>
              <Plus size={16} />
              {t("agents.create")}
            </button>
          </Tooltip>
          <Tooltip text={t("agents.createKnowledgeTooltip")}>
            <button className="secondary-button" type="button" onClick={createKnowledgeSource}>
              <HelpCircle size={16} />
              {t("agents.createKnowledge")}
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
                <strong>{t("agents.boundSources")}</strong>
                <span>
                  {(bindings[agent.id] ?? agent.knowledgeBaseIds)
                    .map((sourceId) => knowledgeSources.find((item) => item.id === sourceId)?.name)
                    .filter(Boolean)
                    .join("、") || t("agents.unbound")}
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
                <summary>{t("agents.editBindings")}</summary>
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
                {t("agents.addPrivateKnowledge")}
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
