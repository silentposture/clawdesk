import {
  Boxes,
  Braces,
  Building2,
  Calendar,
  Chrome,
  Cloud,
  Code2,
  Container,
  FileText,
  GitBranch,
  Globe2,
  Mail,
  Presentation,
  Search,
  Server,
  Sheet,
  SquareTerminal,
  X,
  PlugZap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { McpActionPreview, McpConnector, McpTool } from "../lib/mcp";
import { planMcpAction, summarizeConnector } from "../lib/mcp";
import { useI18n } from "../lib/i18n";

interface McpPanelProps {
  gatewayBaseUrl?: string;
  onClose: () => void;
}

const appIcons: Record<McpTool["app"], typeof FileText> = {
  Word: FileText,
  Excel: Sheet,
  PowerPoint: Presentation,
  Outlook: Mail,
  OneDrive: Cloud,
  Teams: PlugZap,
  "Google Drive": Cloud,
  "Google Docs": FileText,
  "Google Sheets": Sheet,
  "Google Slides": Presentation,
  Gmail: Mail,
  "Google Calendar": Calendar,
  Chrome,
  Browser: Globe2,
  "VS Code": Code2,
  Xcode: Code2,
  JetBrains: Code2,
  GitHub: GitBranch,
  GitLab: GitBranch,
  Docker: Container,
  Terminal: SquareTerminal,
  AutoCAD: Building2,
  "Fusion 360": Boxes,
  SolidWorks: Boxes,
  MATLAB: Braces,
  Jupyter: Braces,
  AWS: Server,
  Azure: Cloud,
  "Google Cloud": Cloud,
  Cloudflare: Globe2,
  Vercel: Server,
  Supabase: Server,
};

const riskLabelKeys: Record<McpTool["risk"], string> = {
  low: "risk.low",
  medium: "risk.medium",
  high: "risk.high",
};

export function McpPanel({ gatewayBaseUrl, onClose }: McpPanelProps): JSX.Element {
  const { t } = useI18n();
  const [connectors, setConnectors] = useState<McpConnector[]>([]);
  const [selectedConnectorId, setSelectedConnectorId] = useState("microsoft-office");
  const [target, setTarget] = useState("~/Documents/ClawDesk");
  const [preview, setPreview] = useState<McpActionPreview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const selectedConnector = useMemo(
    () => connectors.find((connector) => connector.id === selectedConnectorId),
    [connectors, selectedConnectorId],
  );

  useEffect(() => {
    void loadConnectors();
  }, [gatewayBaseUrl]);

  async function loadConnectors() {
    if (!gatewayBaseUrl) return;
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(`${gatewayBaseUrl}/mcp/connectors`);
      if (!response.ok) throw new Error("bad response");
      const payload = (await response.json()) as { connectors: McpConnector[] };
      setConnectors(payload.connectors);
      setSelectedConnectorId(payload.connectors[0]?.id ?? "microsoft-office");
    } catch {
      setError(t("mcp.loadError"));
    } finally {
      setBusy(false);
    }
  }

  async function connect(connectorId: string) {
    if (!gatewayBaseUrl) return;
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(`${gatewayBaseUrl}/mcp/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectorId }),
      });
      if (!response.ok) throw new Error("bad response");
      await loadConnectors();
    } catch {
      setError(t("mcp.connectError"));
      setBusy(false);
    }
  }

  async function runPreview(tool: McpTool) {
    if (!gatewayBaseUrl || !selectedConnector) return;
    setBusy(true);
    setError(undefined);
    try {
      const localPreview = planMcpAction(selectedConnector, tool.id, target.trim() || "~/Documents");
      const response = await fetch(`${gatewayBaseUrl}/mcp/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(localPreview),
      });
      if (!response.ok) throw new Error("bad response");
      setPreview((await response.json()) as McpActionPreview);
    } catch {
      setError(t("mcp.previewError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel-backdrop" role="presentation">
      <section className="mcp-panel" role="dialog" aria-modal="true" aria-labelledby="mcp-title">
        <header className="provider-header">
          <div>
            <h2 id="mcp-title">{t("mcp.title")}</h2>
            <p>{t("mcp.subtitle")}</p>
          </div>
          <button className="icon-button" type="button" aria-label={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="mcp-layout">
          <aside className="mcp-connectors">
            {connectors.map((connector) => (
              <button
                className={connector.id === selectedConnectorId ? "active" : ""}
                key={connector.id}
                type="button"
                onClick={() => setSelectedConnectorId(connector.id)}
              >
                <PlugZap size={17} />
                <span>
                  <strong>{connector.name}</strong>
                  <small>{summarizeConnector(connector)}</small>
                </span>
              </button>
            ))}
          </aside>

          <section className="mcp-detail">
            {selectedConnector ? (
              <>
                <div className="mcp-detail-head">
                  <div>
                    <span>{selectedConnector.vendor} · {selectedConnector.transport}</span>
                    <h3>{selectedConnector.name}</h3>
                    <p>{selectedConnector.description}</p>
                    {selectedConnector.protocols?.length ? (
                      <small>
                        {t("mcp.protocols", { value: selectedConnector.protocols.map((protocol) => protocol.name).join("、") })}
                      </small>
                    ) : null}
                  </div>
                  <button
                    className="primary-button"
                    type="button"
                    disabled={busy || selectedConnector.status === "connected"}
                    onClick={() => connect(selectedConnector.id)}
                  >
                    {selectedConnector.status === "connected" ? t("mcp.enabled") : t("mcp.enable")}
                  </button>
                </div>

                <label className="mcp-target">
                  <span>{t("mcp.target")}</span>
                  <input value={target} onChange={(event) => setTarget(event.target.value)} />
                </label>

                <div className="mcp-tool-grid">
                  {selectedConnector.tools.map((tool) => {
                    const Icon = appIcons[tool.app];
                    return (
                      <article className="mcp-tool" key={tool.id}>
                        <div>
                          <Icon size={18} />
                          <span>
                            <strong>{tool.name}</strong>
                            <small>{tool.app} · {t("mcp.risk", { risk: t(riskLabelKeys[tool.risk]) })}</small>
                          </span>
                        </div>
                        <p>{tool.description}</p>
                        <button className="secondary-button" type="button" onClick={() => runPreview(tool)} disabled={busy}>
                          <Search size={15} />
                          {t("mcp.previewAction")}
                        </button>
                      </article>
                    );
                  })}
                </div>

                {preview ? (
                  <div className="mcp-preview">
                    <span>{t("mcp.previewTitle")}</span>
                    <strong>{preview.title}</strong>
                    <p>{preview.summary}</p>
                    {preview.protocol ? (
                      <small>
                        {t("mcp.protocolDetail", {
                          name: preview.protocol.name,
                          auth: preview.protocol.auth,
                          transport: preview.protocol.transport,
                        })}
                      </small>
                    ) : null}
                    <small>{preview.requiresApproval ? t("mcp.approvalRequired") : t("mcp.lowRiskTrusted")}</small>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="mcp-empty">{t("mcp.empty")}</div>
            )}
            {error ? <p className="panel-error">{error}</p> : null}
          </section>
        </div>
      </section>
    </div>
  );
}
