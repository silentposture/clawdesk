import { CalendarClock, Play, Workflow, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ScheduledWorkflow, WorkflowTemplate } from "../lib/workflows";
import { buildWorkflowFromTemplate, workflowNeedsApproval } from "../lib/workflows";
import { Tooltip } from "./Tooltip";

interface WorkflowPanelProps {
  gatewayBaseUrl?: string;
  onClose: () => void;
}

export function WorkflowPanel({ gatewayBaseUrl, onClose }: WorkflowPanelProps): JSX.Element {
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
      setError("無法讀取工作流與排程。");
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
      setError("建立工作流失敗。");
      setBusy(false);
    }
  }

  return (
    <div className="panel-backdrop" role="presentation">
      <section className="workflow-panel" role="dialog" aria-modal="true" aria-labelledby="workflow-title">
        <header className="provider-header">
          <div>
            <h2 id="workflow-title">自動化排程與工作流</h2>
            <p>用範本建立可審核的流程；任何跨專案或高風險步驟仍會進入人工授權。</p>
          </div>
          <button className="icon-button" type="button" aria-label="關閉" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="workflow-layout">
          <section className="workflow-column">
            <h3>工作流範本</h3>
            <label className="setup-field compact">
              <span>排程時間</span>
              <input value={scheduleValue} onChange={(event) => setScheduleValue(event.target.value)} />
            </label>
            {templates.map((template) => (
              <article className="workflow-card" key={template.id}>
                <Workflow size={19} />
                <div>
                  <strong>{template.name}</strong>
                  <p>{template.description}</p>
                  <small>{template.steps.length} 個步驟 · {workflowNeedsApproval(template) ? "含授權步驟" : "低風險"}</small>
                </div>
                <Tooltip text="建立後先是草稿，可檢查每個步驟，再啟用排程。">
                  <button className="secondary-button" type="button" disabled={busy} onClick={() => createWorkflow(template)}>
                    建立
                  </button>
                </Tooltip>
              </article>
            ))}
          </section>

          <section className="workflow-column">
            <h3>目前排程</h3>
            {workflows.length === 0 ? <p className="empty-note">尚未建立工作流。</p> : null}
            {workflows.map((workflow) => (
              <article className="workflow-card scheduled" key={workflow.id}>
                <CalendarClock size={19} />
                <div>
                  <strong>{workflow.name}</strong>
                  <p>{workflow.scheduleText}</p>
                  <small>{workflow.status} · 下一次：{workflow.nextRun}</small>
                </div>
                <button className="secondary-button" type="button" disabled={workflow.status !== "active"}>
                  <Play size={14} />
                  執行
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
