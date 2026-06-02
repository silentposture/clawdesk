import { Braces, GitBranch, ListChecks, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  defaultCodingWorkspaceSnapshot,
  summarizeGatewayAdapter,
  type CodingWorkspaceSnapshot,
} from "../lib/codingWorkspace";
import { useI18n } from "../lib/i18n";

interface CodingWorkspacePanelProps {
  gatewayBaseUrl?: string;
  onClose: () => void;
}

export function CodingWorkspacePanel({ gatewayBaseUrl, onClose }: CodingWorkspacePanelProps): JSX.Element {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<CodingWorkspaceSnapshot>(defaultCodingWorkspaceSnapshot);
  const [query, setQuery] = useState("provider");
  const [searchResults, setSearchResults] = useState<Array<{ path: string; area: string; riskLevel: string; preview: string }>>([]);
  const [patchTarget, setPatchTarget] = useState("src/lib/codingWorkspace.ts");
  const [patchSummary, setPatchSummary] = useState(() => t("coding.patchSummaryDefault"));
  const [patchRisk, setPatchRisk] = useState<"low" | "medium" | "high" | "blocked">("high");
  const [patchPreview, setPatchPreview] = useState<{ id: string; queueItemId: string; requiresApproval: boolean }>();

  useEffect(() => {
    void load();
  }, [gatewayBaseUrl]);

  async function load() {
    if (!gatewayBaseUrl) return;
    try {
      const response = await fetch(`${gatewayBaseUrl}/coding-workspace`);
      if (!response.ok) return;
      const payload = (await response.json()) as CodingWorkspaceSnapshot;
      setSnapshot(payload);
    } catch {
      setSnapshot(defaultCodingWorkspaceSnapshot);
    }
  }

  const adapterSummary = useMemo(() => summarizeGatewayAdapter(snapshot.gatewayAdapter), [snapshot.gatewayAdapter]);

  async function runFileSearch() {
    if (!gatewayBaseUrl || !query.trim()) return;
    const response = await fetch(`${gatewayBaseUrl}/coding-workspace/file-search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: query.trim(), maxResults: 8 }),
    });
    if (!response.ok) return;
    const payload = (await response.json()) as { results: Array<{ path: string; area: string; riskLevel: string; preview: string }> };
    setSearchResults(payload.results);
  }

  async function runPatchPreview() {
    if (!gatewayBaseUrl || !patchTarget.trim() || !patchSummary.trim()) return;
    const response = await fetch(`${gatewayBaseUrl}/coding-workspace/patch-preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: patchTarget.trim(), summary: patchSummary.trim(), riskLevel: patchRisk }),
    });
    if (!response.ok) return;
    const payload = (await response.json()) as { preview: { id: string; queueItemId: string; requiresApproval: boolean } };
    setPatchPreview(payload.preview);
  }

  return (
    <div className="panel-backdrop" role="presentation">
      <section className="coding-workspace-panel" role="dialog" aria-modal="true" aria-labelledby="coding-workspace-title">
        <header className="provider-header">
          <div>
            <h2 id="coding-workspace-title">{t("coding.title")}</h2>
            <p>{t("coding.subtitle")}</p>
          </div>
          <button className="icon-button" type="button" aria-label={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <section className="workspace-capability-grid">
          {snapshot.capabilities.map((capability) => (
            <article className="agent-card" key={capability.id}>
              <ListChecks size={21} />
              <h3>{capability.label}</h3>
              <p>{capability.description}</p>
              <small>{capability.status}</small>
            </article>
          ))}
        </section>

        <section className="coding-workspace-layout">
          <article className="commercial-card">
            <GitBranch size={22} />
            <h3>{t("coding.subagents.title")}</h3>
            <p>{t("coding.subagents.description")}</p>
            <div className="subagent-grid">
              {snapshot.subagents.map((agent) => (
                <div key={agent.id}>
                  <strong>{agent.label}</strong>
                  <span>{agent.status}</span>
                  <small>{agent.responsibility}</small>
                </div>
              ))}
            </div>
          </article>

          <article className="commercial-card">
            <Braces size={22} />
            <h3>{t("coding.gateway.title")}</h3>
            <p>{t("coding.gateway.summary", adapterSummary)}</p>
            <dl className="adapter-list">
              {snapshot.gatewayAdapter.map((method) => (
                <div key={method.name}>
                  <dt>{method.name}</dt>
                  <dd>
                    {method.method} {method.path} · {method.status}
                  </dd>
                </div>
              ))}
            </dl>
          </article>
        </section>

        <section className="panel-actions">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("coding.search.placeholder")} />
          <button className="secondary-button" type="button" onClick={runFileSearch}>{t("coding.search.button")}</button>
          <input value={patchTarget} onChange={(event) => setPatchTarget(event.target.value)} placeholder={t("coding.patch.target")} />
          <input value={patchSummary} onChange={(event) => setPatchSummary(event.target.value)} placeholder={t("coding.patch.summary")} />
          <select value={patchRisk} onChange={(event) => setPatchRisk(event.target.value as "low" | "medium" | "high" | "blocked")}>
            <option value="low">{t("risk.low")}</option>
            <option value="medium">{t("risk.medium")}</option>
            <option value="high">{t("risk.high")}</option>
            <option value="blocked">{t("risk.blocked")}</option>
          </select>
          <button className="primary-button" type="button" onClick={runPatchPreview}>{t("coding.patch.button")}</button>
        </section>

        {searchResults.length > 0 ? (
          <section className="adapter-list">
            {searchResults.map((item) => (
              <div key={`${item.path}-${item.area}`}>
                <dt>{item.path}</dt>
                <dd>{item.area} · {item.riskLevel} · {item.preview}</dd>
              </div>
            ))}
          </section>
        ) : null}

        {patchPreview ? (
          <p className="empty-note">
            {t("coding.preview", {
              id: patchPreview.id,
              queueId: patchPreview.queueItemId,
              approval: patchPreview.requiresApproval ? t("common.required") : t("common.notRequired"),
            })}
          </p>
        ) : null}
      </section>
    </div>
  );
}
