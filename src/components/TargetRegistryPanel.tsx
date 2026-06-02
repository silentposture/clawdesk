import { CircleAlert, CircleCheck, Plus, RefreshCw, Save, Send, Server, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  cloneTargetRegistry,
  createTargetDispatchRecord,
  createTargetProfile,
  defaultTargetRegistry,
  decideTargetDispatch,
  summarizeTargetProfile,
  summarizeTargetRegistry,
  upsertTarget,
  type TargetConnectionState,
  type TargetDispatchCategory,
  type TargetDispatchDecision,
  type TargetDispatchRecord,
  type TargetDispatchRequest,
  type TargetKind,
  type TargetProfile,
  type TargetRegistry,
} from "../lib/targets";
import { useI18n } from "../lib/i18n";

interface TargetRegistryPanelProps {
  gatewayBaseUrl?: string;
  onClose: () => void;
}

interface TargetDraftState {
  id: string;
  displayName: string;
  kind: TargetKind;
  endpoint: string;
  state: TargetConnectionState;
  paired: boolean;
  authenticated: boolean;
  hostKeyVerified: boolean;
  trustedWorkspaces: string;
}

interface DispatchPreviewState {
  target: TargetProfile;
  request: TargetDispatchRequest;
  decision: TargetDispatchDecision;
  record: TargetDispatchRecord;
}

const initialRegistry = defaultTargetRegistry();
const initialTarget = initialRegistry.targets[0];

const kindOptions: Array<{ value: TargetKind; label: string; endpoint: string; description: string }> = [
  {
    value: "local-shell",
    label: "本機 Shell",
    endpoint: "local://workspace",
    description: "同一台電腦上的本機工作區與 shell。",
  },
  {
    value: "ssh-terminal",
    label: "SSH 終端機",
    endpoint: "ssh://builder.example.internal",
    description: "遠端 Linux / Windows 主機的終端機連線。",
  },
  {
    value: "remote-desktop",
    label: "遠端桌面",
    endpoint: "rdp://ops.example.internal",
    description: "以螢幕 / session 控制為主的遠端桌面。",
  },
  {
    value: "mock",
    label: "Mock Target",
    endpoint: "mock://lab",
    description: "本機測試用 target，方便驗證 dispatch contract。",
  },
];

const stateOptions: Array<{ value: TargetConnectionState; label: string }> = [
  { value: "ready", label: "ready" },
  { value: "connecting", label: "connecting" },
  { value: "degraded", label: "degraded" },
  { value: "offline", label: "offline" },
];

const dispatchCategoryOptions: Array<{ value: TargetDispatchCategory; label: string; description: string }> = [
  { value: "observe", label: "觀察", description: "看螢幕、終端機輸出或 target 狀態。" },
  { value: "inspect", label: "檢查", description: "查 log、metadata、版本或設定摘要。" },
  { value: "debug", label: "除錯", description: "收集 redacted debug bundle 或診斷資訊。" },
  { value: "execute_safe", label: "安全執行", description: "只允許 allowlist 指令，且仍需人工審批。" },
  { value: "request_approval", label: "人工審批", description: "建立下一步的人工確認請求。" },
];

function defaultEndpointForKind(kind: TargetKind): string {
  return kindOptions.find((option) => option.value === kind)?.endpoint ?? "local://workspace";
}

function defaultDisplayNameForKind(kind: TargetKind): string {
  return kindOptions.find((option) => option.value === kind)?.label ?? "未命名目標";
}

function createDraftId(kind: TargetKind): string {
  return `target-${kind}-${Date.now().toString(36)}`;
}

function createDispatchId(): string {
  return `dispatch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultTrustedWorkspaceList(): string {
  return ["~/ClawDesk Projects/桌面 GUI"].join("\n");
}

function createDraft(kind: TargetKind = "ssh-terminal"): TargetDraftState {
  const localLike = kind === "local-shell" || kind === "mock";
  return {
    id: createDraftId(kind),
    displayName: defaultDisplayNameForKind(kind),
    kind,
    endpoint: defaultEndpointForKind(kind),
    state: localLike ? "ready" : "offline",
    paired: localLike,
    authenticated: localLike,
    hostKeyVerified: localLike,
    trustedWorkspaces: defaultTrustedWorkspaceList(),
  };
}

function draftFromTarget(target: TargetProfile): TargetDraftState {
  const adapter = target.adapters[0];
  return {
    id: target.id,
    displayName: target.displayName,
    kind: target.kind,
    endpoint: adapter?.endpoint ?? defaultEndpointForKind(target.kind),
    state: target.state,
    paired: target.paired,
    authenticated: adapter?.authenticated ?? false,
    hostKeyVerified: adapter?.hostKeyVerified ?? false,
    trustedWorkspaces: target.trustedWorkspaces.join("\n"),
  };
}

function parseTrustedWorkspaces(value: string): string[] {
  return value
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildTargetFromDraft(draft: TargetDraftState): TargetProfile {
  return createTargetProfile({
    id: draft.id.trim() || createDraftId(draft.kind),
    displayName: draft.displayName.trim() || defaultDisplayNameForKind(draft.kind),
    kind: draft.kind,
    endpoint: draft.endpoint.trim() || defaultEndpointForKind(draft.kind),
    state: draft.state,
    paired: draft.paired,
    trustedWorkspaces: parseTrustedWorkspaces(draft.trustedWorkspaces),
    adapterOverrides: {
      authenticated: draft.authenticated,
      hostKeyVerified: draft.hostKeyVerified,
    },
  });
}

function dispatchStatusLabel(decision: TargetDispatchDecision): string {
  if (!decision.allowed) return "阻擋";
  return decision.requiresApproval ? "需審批" : "允許";
}

function dispatchStatusClass(decision: TargetDispatchDecision): string {
  if (!decision.allowed) return "risk-blocked";
  return decision.requiresApproval ? "risk-medium" : "risk-low";
}

export function TargetRegistryPanel({ gatewayBaseUrl, onClose }: TargetRegistryPanelProps): JSX.Element {
  const { t } = useI18n();
  const [registry, setRegistry] = useState<TargetRegistry>(() => cloneTargetRegistry(initialRegistry));
  const [dispatches, setDispatches] = useState<TargetDispatchRecord[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState(
    initialRegistry.defaultTargetId ?? initialRegistry.targets[0]?.id ?? "",
  );
  const [draft, setDraft] = useState<TargetDraftState>(() =>
    draftFromTarget(initialTarget ?? createTargetProfile({
      id: "ssh-default",
      displayName: "SSH 終端機",
      kind: "ssh-terminal",
      endpoint: "ssh://builder.example.internal",
    })),
  );
  const [dispatchCategory, setDispatchCategory] = useState<TargetDispatchCategory>("observe");
  const [dispatchSummary, setDispatchSummary] = useState("檢視指定 target 的目前狀態。");
  const [dispatchCommand, setDispatchCommand] = useState("git status");
  const [preview, setPreview] = useState<DispatchPreviewState>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  const summary = useMemo(() => summarizeTargetRegistry(registry), [registry]);
  const selectedTarget = useMemo(() => registry.targets.find((target) => target.id === selectedTargetId), [registry, selectedTargetId]);
  const draftTarget = useMemo(() => buildTargetFromDraft(draft), [draft]);
  const draftIsSaved = Boolean(selectedTarget && selectedTarget.id === draftTarget.id);
  const trustedWorkspaceCount = draft.trustedWorkspaces
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean).length;

  useEffect(() => {
    void loadTargets();
  }, [gatewayBaseUrl]);

  async function loadTargets() {
    if (!gatewayBaseUrl) {
      setRegistry(cloneTargetRegistry(initialRegistry));
      setDispatches([]);
      const nextTarget = initialRegistry.targets[0];
      if (nextTarget) {
        setSelectedTargetId(nextTarget.id);
        setDraft(draftFromTarget(nextTarget));
      }
      setPreview(undefined);
      setMessage("已使用本機預設 target 登錄。");
      setError(undefined);
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(`${gatewayBaseUrl}/targets`);
      if (!response.ok) throw new Error("bad response");
      const payload = (await response.json()) as { registry?: TargetRegistry; dispatches?: TargetDispatchRecord[] };
      const nextRegistry = payload.registry?.targets?.length ? payload.registry : cloneTargetRegistry(initialRegistry);
      const nextTargetId = nextRegistry.defaultTargetId ?? nextRegistry.targets[0]?.id ?? "";
      const nextTarget = nextRegistry.targets.find((target) => target.id === nextTargetId) ?? nextRegistry.targets[0];
      setRegistry(cloneTargetRegistry(nextRegistry));
      setDispatches(Array.isArray(payload.dispatches) ? payload.dispatches : []);
      if (nextTarget) {
        setSelectedTargetId(nextTarget.id);
        setDraft(draftFromTarget(nextTarget));
      } else {
        setSelectedTargetId("");
        setDraft(createDraft("ssh-terminal"));
      }
      setPreview(undefined);
      setMessage("已讀取 gateway target registry。");
    } catch {
      setRegistry(cloneTargetRegistry(initialRegistry));
      setDispatches([]);
      const nextTarget = initialRegistry.targets[0];
      if (nextTarget) {
        setSelectedTargetId(nextTarget.id);
        setDraft(draftFromTarget(nextTarget));
      }
      setPreview(undefined);
      setError("無法讀取 gateway 的 target registry，已切回本機預設清單。");
    } finally {
      setBusy(false);
    }
  }

  function selectExistingTarget(target: TargetProfile) {
    setSelectedTargetId(target.id);
    setDraft(draftFromTarget(target));
    setPreview(undefined);
    setMessage(undefined);
    setError(undefined);
  }

  function startDraft(kind: TargetKind) {
    const nextDraft = createDraft(kind);
    setSelectedTargetId(nextDraft.id);
    setDraft(nextDraft);
    setPreview(undefined);
    setMessage(`已建立 ${defaultDisplayNameForKind(kind)} 的草稿。`);
    setError(undefined);
  }

  async function persistRegistry(nextRegistry: TargetRegistry, statusMessage: string) {
    setBusy(true);
    setError(undefined);
    try {
      if (gatewayBaseUrl) {
        const response = await fetch(`${gatewayBaseUrl}/targets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ registry: nextRegistry }),
        });
        if (!response.ok) throw new Error("bad response");
        const payload = (await response.json()) as { registry?: TargetRegistry; dispatches?: TargetDispatchRecord[] };
        if (payload.registry?.targets?.length) {
          setRegistry(cloneTargetRegistry(payload.registry));
          if (Array.isArray(payload.dispatches)) {
            setDispatches(payload.dispatches);
          }
        } else {
          setRegistry(cloneTargetRegistry(nextRegistry));
        }
      } else {
        setRegistry(cloneTargetRegistry(nextRegistry));
      }
      setPreview(undefined);
      setMessage(statusMessage);
    } catch {
      setRegistry(cloneTargetRegistry(nextRegistry));
      setPreview(undefined);
      setMessage(`${statusMessage}（僅保留本機狀態，gateway 儲存失敗）`);
      setError(undefined);
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft(makeDefault = false) {
    const target = buildTargetFromDraft(draft);
    const nextRegistry = upsertTarget(registry, target);
    if (makeDefault) {
      nextRegistry.defaultTargetId = target.id;
    }
    setSelectedTargetId(target.id);
    setDraft(draftFromTarget(target));
    await persistRegistry(nextRegistry, makeDefault ? `已儲存 ${target.displayName} 並設為預設 target。` : `已儲存 ${target.displayName}。`);
  }

  function buildRequest(): TargetDispatchRequest {
    return {
      category: dispatchCategory,
      summary: dispatchSummary.trim(),
      command: dispatchCommand.trim() || undefined,
    };
  }

  function createPreviewSnapshot(target: TargetProfile): DispatchPreviewState {
    const request = buildRequest();
    const decision = decideTargetDispatch(target, request);
    const record = createTargetDispatchRecord(target, request, decision, createDispatchId());
    return { target, request, decision, record };
  }

  async function previewDispatch() {
    const snapshot = createPreviewSnapshot(draftTarget);
    setPreview(snapshot);
    setMessage(`已產生 ${snapshot.target.displayName} 的派發預覽。`);
    setError(undefined);

    if (!gatewayBaseUrl) return;

    try {
      const response = await fetch(`${gatewayBaseUrl}/targets/dispatch-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preview: snapshot }),
      });
      if (!response.ok) throw new Error("bad response");
    } catch {
      setError("派發預覽已在本機產生，但 gateway 回傳失敗。");
    }
  }

  async function queueDispatch() {
    const snapshot = createPreviewSnapshot(draftTarget);
    setPreview(snapshot);

    if (gatewayBaseUrl) {
      try {
        const response = await fetch(`${gatewayBaseUrl}/targets/dispatch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ record: snapshot.record }),
        });
        if (!response.ok) throw new Error("bad response");
        const payload = (await response.json()) as { dispatches?: TargetDispatchRecord[] };
        if (Array.isArray(payload.dispatches)) {
          setDispatches(payload.dispatches);
        } else {
          setDispatches((current) => [snapshot.record, ...current].slice(0, 100));
        }
        setMessage(`已建立 ${snapshot.record.targetName} 的派發紀錄。`);
        setError(undefined);
        return;
      } catch {
        setMessage(`已建立本機派發紀錄，但 gateway 儲存失敗。`);
      }
    }

    setDispatches((current) => [snapshot.record, ...current].slice(0, 100));
    setMessage(`已建立 ${snapshot.record.targetName} 的派發紀錄。`);
    setError(undefined);
  }

  return (
    <div className="panel-backdrop" role="presentation">
      <section className="provider-panel target-registry-panel" role="dialog" aria-modal="true" aria-labelledby="target-registry-title">
        <header className="provider-header">
          <div>
            <h2 id="target-registry-title">Target Registry</h2>
            <p>把 local-shell、SSH 終端機與遠端桌面收斂成同一個安全派發面板。</p>
          </div>
          <div className="panel-actions">
            <button className="secondary-button" type="button" onClick={loadTargets} disabled={busy}>
              <RefreshCw size={16} />
              重新讀取
            </button>
            <button className="icon-button" type="button" aria-label={t("common.close")} onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </header>

        <section className="comparison-summary">
          <article className="commercial-card">
            <Server size={23} />
            <h3>總目標數 {summary.totalTargets}</h3>
            <p>預設目標：{summary.defaultTargetName ?? "未設定"}</p>
          </article>
          <article className="commercial-card">
            <CircleCheck size={23} />
            <h3>就緒 {summary.readyTargets} · 已配對 {summary.pairedTargets}</h3>
            <p>只有就緒且已配對的 target 才會進入安全派發選擇。</p>
          </article>
          <article className="commercial-card">
            <CircleAlert size={23} />
            <h3>dispatch log {dispatches.length}</h3>
            <p>先預覽，再送出紀錄；高風險或未配對狀態會被 contract 擋下。</p>
          </article>
        </section>

        <section className="target-registry-layout">
          <section className="commercial-card">
            <div className="panel-actions">
              <button className="secondary-button" type="button" onClick={() => startDraft("local-shell")} disabled={busy}>
                <Plus size={16} />
                新增本機
              </button>
              <button className="secondary-button" type="button" onClick={() => startDraft("ssh-terminal")} disabled={busy}>
                <Plus size={16} />
                新增 SSH
              </button>
              <button className="secondary-button" type="button" onClick={() => startDraft("remote-desktop")} disabled={busy}>
                <Plus size={16} />
                新增遠端桌面
              </button>
              <button className="secondary-button" type="button" onClick={() => startDraft("mock")} disabled={busy}>
                <Plus size={16} />
                新增 Mock
              </button>
            </div>
            <div className="target-list">
              {registry.targets.map((target) => {
                const active = selectedTargetId === target.id;
                return (
                  <button key={target.id} type="button" className={active ? "active" : ""} onClick={() => selectExistingTarget(target)}>
                    <strong>{target.displayName}</strong>
                    <small>{summarizeTargetProfile(target)}</small>
                    <small>{target.adapters[0]?.endpoint ?? "未設定 endpoint"}</small>
                    <small>
                      {target.id}
                      {registry.defaultTargetId === target.id ? " · 預設" : ""}
                    </small>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="commercial-card target-draft-form">
            <div>
              <h3>{draftIsSaved ? "目標設定" : "新目標草稿"}</h3>
              <p>這裡定義每台電腦的連線類型、配對狀態與可授權範圍。</p>
            </div>
            <label>
              <span>Target ID</span>
              <input value={draft.id} onChange={(event) => setDraft((current) => ({ ...current, id: event.target.value }))} />
            </label>
            <label>
              <span>顯示名稱</span>
              <input value={draft.displayName} onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))} />
            </label>
            <label>
              <span>類型</span>
              <select
                value={draft.kind}
                onChange={(event) => {
                  const nextKind = event.target.value as TargetKind;
                  setDraft((current) => {
                    const localLike = nextKind === "local-shell" || nextKind === "mock";
                    return {
                      ...current,
                      kind: nextKind,
                      endpoint: current.endpoint.trim() ? current.endpoint : defaultEndpointForKind(nextKind),
                      state: localLike ? "ready" : current.state === "ready" ? "offline" : current.state,
                      paired: localLike ? true : current.paired,
                      authenticated: localLike ? true : current.authenticated,
                      hostKeyVerified: localLike ? true : nextKind === "ssh-terminal" ? current.hostKeyVerified : false,
                    };
                  });
                }}
              >
                {kindOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Endpoint</span>
              <input value={draft.endpoint} onChange={(event) => setDraft((current) => ({ ...current, endpoint: event.target.value }))} />
            </label>
            <label>
              <span>連線狀態</span>
              <select value={draft.state} onChange={(event) => setDraft((current) => ({ ...current, state: event.target.value as TargetConnectionState }))}>
                {stateOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="target-toggle">
              <span>已配對</span>
              <input type="checkbox" checked={draft.paired} onChange={(event) => setDraft((current) => ({ ...current, paired: event.target.checked }))} />
            </label>
            <label className="target-toggle">
              <span>已驗證認證</span>
              <input type="checkbox" checked={draft.authenticated} onChange={(event) => setDraft((current) => ({ ...current, authenticated: event.target.checked }))} />
            </label>
            <label className="target-toggle">
              <span>SSH host key verified</span>
              <input type="checkbox" checked={draft.hostKeyVerified} onChange={(event) => setDraft((current) => ({ ...current, hostKeyVerified: event.target.checked }))} />
            </label>
            <label>
              <span>Trusted workspaces</span>
              <textarea
                value={draft.trustedWorkspaces}
                onChange={(event) => setDraft((current) => ({ ...current, trustedWorkspaces: event.target.value }))}
                placeholder="每行一個工作區，或用逗號分隔"
              />
              <small>目前解析出 {trustedWorkspaceCount} 個 trusted workspace。</small>
            </label>
            <div className="panel-actions">
              <button className="primary-button" type="button" onClick={() => void saveDraft(false)} disabled={busy}>
                <Save size={16} />
                儲存目標
              </button>
              <button className="secondary-button" type="button" onClick={() => void saveDraft(true)} disabled={busy}>
                <Save size={16} />
                儲存並設為預設
              </button>
            </div>
            <small>
              目前狀態：{selectedTarget ? summarizeTargetProfile(selectedTarget) : "草稿尚未儲存"} · {draftIsSaved ? "已對齊 registry" : "編輯中"}
            </small>
          </section>

          <section className="commercial-card target-dispatch-form">
            <div>
              <h3>派發預覽</h3>
              <p>先做本地判斷，再把安全決策送到 gateway 當成 audit record。</p>
            </div>
            <label>
              <span>分類</span>
              <select value={dispatchCategory} onChange={(event) => setDispatchCategory(event.target.value as TargetDispatchCategory)}>
                {dispatchCategoryOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>摘要</span>
              <textarea value={dispatchSummary} onChange={(event) => setDispatchSummary(event.target.value)} placeholder="說明這次要做什麼" />
            </label>
            <label>
              <span>命令 / 動作</span>
              <textarea
                value={dispatchCommand}
                onChange={(event) => setDispatchCommand(event.target.value)}
                placeholder="例如 git status / collect-debug-bundle / request-human-approval"
              />
            </label>
            <div className="panel-actions">
              <button className="primary-button" type="button" onClick={() => void previewDispatch()} disabled={busy || !draftTarget.id.trim() || !dispatchSummary.trim()}>
                <Server size={16} />
                預覽
              </button>
              <button className="secondary-button" type="button" onClick={() => void queueDispatch()} disabled={busy || !draftSummaryReady(dispatchSummary)}>
                <Send size={16} />
                建立紀錄
              </button>
            </div>

            {preview ? (
              <div className="mcp-preview">
                <span>最新預覽</span>
                <strong>{preview.target.displayName}</strong>
                <p>{preview.request.summary}</p>
                <small>
                  {preview.request.category} · {dispatchStatusLabel(preview.decision)} · {preview.decision.reason}
                </small>
                <small>adapter：{preview.decision.adapterKind ?? "unknown"}{preview.decision.commandSafety ? ` · command=${preview.decision.commandSafety}` : ""}</small>
              </div>
            ) : (
              <div className="mcp-empty">尚未產生預覽，請先按「預覽」。</div>
            )}

            <dl className="status-list">
              <div>
                <dt>目標</dt>
                <dd>{draftTarget.displayName} · {draftTarget.kind} · {draftTarget.state}</dd>
              </div>
              <div>
                <dt>安全狀態</dt>
                <dd>
                  {preview ? (
                    <span className={`risk-pill ${dispatchStatusClass(preview.decision)}`}>{dispatchStatusLabel(preview.decision)}</span>
                  ) : (
                    "等待預覽"
                  )}
                </dd>
              </div>
              <div>
                <dt>trusted workspaces</dt>
                <dd>{trustedWorkspaceCount > 0 ? trustedWorkspaceCount : "未設定"}</dd>
              </div>
            </dl>

            <section className="adapter-list">
              {dispatches.slice(0, 6).map((record) => (
                <div key={record.id}>
                  <dt>
                    {record.targetName} · {record.category}
                  </dt>
                  <dd>
                    {record.decision.allowed ? "allow" : "block"} · {dispatchStatusLabel(record.decision)} · {record.decision.reason}
                  </dd>
                  {record.command ? <dd>command：{record.command}</dd> : null}
                </div>
              ))}
              {dispatches.length === 0 ? <div><dt>dispatch log</dt><dd>尚未有派發紀錄。</dd></div> : null}
            </section>
          </section>
        </section>

        {message ? <p className="panel-success">{message}</p> : null}
        {error ? <p className="panel-error">{error}</p> : null}
      </section>
    </div>
  );
}

function draftSummaryReady(summary: string): boolean {
  return summary.trim().length > 0;
}
