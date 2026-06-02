import { CalendarClock, Play, Workflow, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ScheduledWorkflow, WorkflowTemplate } from "../lib/workflows";
import { buildWorkflowFromTemplate, workflowNeedsApproval } from "../lib/workflows";
import { useI18n } from "../lib/i18n";
import { Tooltip } from "./Tooltip";

interface WorkflowPanelProps {
  gatewayBaseUrl?: string;
  onClose: () => void;
}

export function WorkflowPanel({ gatewayBaseUrl, onClose }: WorkflowPanelProps): JSX.Element {
  const { t } = useI18n();
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [workflows, setWorkflows] = useState<ScheduledWorkflow[]>([]);
  const [scheduleValue, setScheduleValue] = useState("09:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void loadWorkflows();
  }, [gatewayBaseUrl]);

  async function loadWorkflows() {
    if (!gatewayBaseUrl) return;
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(`${gatewayBaseUrl}/workflows`);
      if (!response.ok) throw new Error("bad response");
      const payload = (await response.json()) as { templates: WorkflowTemplate[]; workflows: ScheduledWorkflow[] };
      setTemplates(payload.templates);
      setWorkflows(payload.workflows);
    } catch {
      setError(t("workflow.loadError"));
    } finally {
      setBusy(false);
    }
  }

  async function createWorkflow(template: WorkflowTemplate) {
    if (!gatewayBaseUrl) return;
    const draft = buildWorkflowFromTemplate(template, scheduleValue);
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(`${gatewayBaseUrl}/workflows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!response.ok) throw new Error("bad response");
      await loadWorkflows();
    } catch {
      setError(t("workflow.createError"));
      setBusy(false);
    }
  }

  return (
    <div className="panel-backdrop" role="presentation">
      <section className="workflow-panel" role="dialog" aria-modal="true" aria-labelledby="workflow-title">
        <header className="provider-header">
          <div>
            <h2 id="workflow-title">{t("workflow.title")}</h2>
            <p>{t("workflow.subtitle")}</p>
          </div>
          <button className="icon-button" type="button" aria-label={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="workflow-layout">
          <section className="workflow-column">
            <h3>{t("workflow.templates")}</h3>
            <label className="setup-field compact">
              <span>{t("workflow.scheduleTime")}</span>
              <input value={scheduleValue} onChange={(event) => setScheduleValue(event.target.value)} />
            </label>
            {templates.map((template) => (
              <article className="workflow-card" key={template.id}>
                <Workflow size={19} />
                <div>
                  <strong>{template.name}</strong>
                  <p>{template.description}</p>
                  <small>
                    {t("workflow.stepCount", { count: template.steps.length })} · {workflowNeedsApproval(template) ? t("workflow.requiresApproval") : t("workflow.lowRisk")}
                  </small>
                </div>
                <Tooltip text={t("workflow.createTooltip")}>
                  <button className="secondary-button" type="button" disabled={busy} onClick={() => createWorkflow(template)}>
                    {t("workflow.create")}
                  </button>
                </Tooltip>
              </article>
            ))}
          </section>

          <section className="workflow-column">
            <h3>{t("workflow.current")}</h3>
            {workflows.length === 0 ? <p className="empty-note">{t("workflow.empty")}</p> : null}
            {workflows.map((workflow) => (
              <article className="workflow-card scheduled" key={workflow.id}>
                <CalendarClock size={19} />
                <div>
                  <strong>{workflow.name}</strong>
                  <p>{workflow.scheduleText}</p>
                  <small>{workflow.status} · {t("workflow.nextRun", { value: workflow.nextRun })}</small>
                </div>
                <button className="secondary-button" type="button" disabled={workflow.status !== "active"}>
                  <Play size={14} />
                  {t("workflow.run")}
                </button>
              </article>
            ))}
            {error ? <p className="panel-error">{error}</p> : null}
          </section>
        </div>
      </section>
    </div>
  );
}
