import { CSSProperties, FormEvent, KeyboardEvent, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  Bot,
  BrainCircuit,
  Cable,
  CircleAlert,
  CircleCheck,
  ClipboardCheck,
  Code2,
  Copyright,
  Database,
  Film,
  FolderLock,
  Gauge,
  ImagePlus,
  KeyRound,
  Laptop,
  LockKeyhole,
  ShieldCheck,
  MessagesSquare,
  PlugZap,
  Server,
  Send,
  Settings2,
  Sidebar,
  Scale,
  ShieldAlert,
  SquareSplitHorizontal,
  Stethoscope,
  User,
  UserRoundCog,
  UsersRound,
  Workflow,
  X,
} from "lucide-react";
import { CanvasRenderer } from "./components/CanvasRenderer";
import { AccountsPanel } from "./components/AccountsPanel";
import { AgentsPanel } from "./components/AgentsPanel";
import { ChannelsPanel } from "./components/ChannelsPanel";
import { CodingWorkspacePanel } from "./components/CodingWorkspacePanel";
import { ComparisonPanel } from "./components/ComparisonPanel";
import { ContextBudgetPanel } from "./components/ContextBudgetPanel";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel";
import { ErgonomicsPanel } from "./components/ErgonomicsPanel";
import { LearningPanel } from "./components/LearningPanel";
import { LegalConsentModal } from "./components/LegalConsentModal";
import { LegalPanel } from "./components/LegalPanel";
import { LicensePanel } from "./components/LicensePanel";
import { MediaPanel } from "./components/MediaPanel";
import { MemoryPanel } from "./components/MemoryPanel";
import { IdentityPanel } from "./components/IdentityPanel";
import { McpPanel } from "./components/McpPanel";
import { CompatSettingsPanel } from "./components/CompatSettingsPanel";
import { PermissionModal } from "./components/PermissionModal";
import { ProviderPanel } from "./components/ProviderPanel";
import { QuickSetupModal } from "./components/QuickSetupModal";
import { SafetyQueuePanel } from "./components/SafetyQueuePanel";
import { SecurityPanel } from "./components/SecurityPanel";
import { TargetRegistryPanel } from "./components/TargetRegistryPanel";
import { Tooltip } from "./components/Tooltip";
import { WorkflowPanel } from "./components/WorkflowPanel";
import { WorkspacePanel } from "./components/WorkspacePanel";
import { canvasReducer, getActiveSurface, initialCanvasState } from "./lib/canvas";
import { parseGatewayEvent, serializePermissionResult, type GatewayEvent, type PermissionRequestEvent } from "./lib/events";
import { defaultProviderSession, providerStatusLabel, type ProviderSession } from "./lib/providers";
import { defaultIdentitySession, readableMode, type IdentitySession } from "./lib/identity";
import { defaultSandboxPolicy, type SandboxPolicy } from "./lib/security";
import {
  ensureGateway,
  readLegalConsentFromApp,
  sendPermissionResult,
  writeLegalConsentToApp,
  type GatewayInfo,
} from "./lib/tauri";
import { initialWorkspaceState, selectedProject, workspaceReducer } from "./lib/workspaces";
import { type LocalePreference, useI18n } from "./lib/i18n";
import {
  readLegalConsentRecord,
  parseLegalConsentRecord,
  writeLegalConsentRecord,
  type LegalConsentRecord,
} from "./lib/legalConsent";

interface ChatMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  done?: boolean;
  attachments?: ComposerAttachment[];
}

interface ComposerAttachment {
  id: string;
  name: string;
  mimeType: string;
  previewUrl: string;
  dataUrl: string;
  sizeBytes: number;
}

type ConnectGateway = (preferredGateway?: GatewayInfo) => Promise<void>;

const conversationId = "demo-conversation";

const maxMessages = 80;
const quickSetupCompletedKey = "clawdesk.quickSetup.completed";

function readQuickSetupCompleted(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(quickSetupCompletedKey) === "true";
}

function writeQuickSetupCompleted(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(quickSetupCompletedKey, "true");
}

function shouldShowQuickSetup(): boolean {
  return Boolean(readLegalConsentRecord()) && !readQuickSetupCompleted();
}

export default function App(): JSX.Element {
  const { t, setLocale, preference, supportedLocales } = useI18n();

  const [gateway, setGateway] = useState<GatewayInfo>();
  const [gatewayStatus, setGatewayStatus] = useState<"starting" | "ready" | "degraded" | "offline">("starting");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "agent",
      content: t("app.welcome"),
      done: true,
    },
  ]);
  const [prompt, setPrompt] = useState("");
  const [pendingPermission, setPendingPermission] = useState<PermissionRequestEvent>();
  const [mcpPanelOpen, setMcpPanelOpen] = useState(false);
  const [channelsPanelOpen, setChannelsPanelOpen] = useState(false);
  const [accountsPanelOpen, setAccountsPanelOpen] = useState(false);
  const [workflowPanelOpen, setWorkflowPanelOpen] = useState(false);
  const [mediaPanelOpen, setMediaPanelOpen] = useState(false);
  const [learningPanelOpen, setLearningPanelOpen] = useState(false);
  const [securityPanelOpen, setSecurityPanelOpen] = useState(false);
  const [compatSettingsOpen, setCompatSettingsOpen] = useState(false);
  const [licensePanelOpen, setLicensePanelOpen] = useState(false);
  const [legalPanelOpen, setLegalPanelOpen] = useState(false);
  const [diagnosticsPanelOpen, setDiagnosticsPanelOpen] = useState(false);
  const [memoryPanelOpen, setMemoryPanelOpen] = useState(false);
  const [agentsPanelOpen, setAgentsPanelOpen] = useState(false);
  const [ergonomicsPanelOpen, setErgonomicsPanelOpen] = useState(false);
  const [comparisonPanelOpen, setComparisonPanelOpen] = useState(false);
  const [codingWorkspacePanelOpen, setCodingWorkspacePanelOpen] = useState(false);
  const [contextBudgetPanelOpen, setContextBudgetPanelOpen] = useState(false);
  const [safetyQueuePanelOpen, setSafetyQueuePanelOpen] = useState(false);
  const [targetRegistryPanelOpen, setTargetRegistryPanelOpen] = useState(false);
  const [identityPanelOpen, setIdentityPanelOpen] = useState(false);
  const [legalConsent, setLegalConsent] = useState<LegalConsentRecord | undefined>(() => readLegalConsentRecord());
  const [quickSetupOpen, setQuickSetupOpen] = useState(() => shouldShowQuickSetup());
  const [providerPanelOpen, setProviderPanelOpen] = useState(false);
  const [leftPaneCollapsed, setLeftPaneCollapsed] = useState(false);
  const [rightPaneCollapsed, setRightPaneCollapsed] = useState(false);
  const [providerSession, setProviderSession] = useState<ProviderSession>(defaultProviderSession);
  const [identitySession, setIdentitySession] = useState<IdentitySession>(defaultIdentitySession());
  const [sandboxPolicy, setSandboxPolicy] = useState<SandboxPolicy>(defaultSandboxPolicy);
  const [canvasState, dispatchCanvas] = useReducer(canvasReducer, initialCanvasState);
  const [workspaceState, dispatchWorkspace] = useReducer(workspaceReducer, initialWorkspaceState);
  const wsRef = useRef<WebSocket>();
  const deltaBufferRef = useRef<Map<string, string>>(new Map());
  const rafRef = useRef<number>();
  const reconnectTimerRef = useRef<number>();
  const reconnectAttemptRef = useRef(0);
  const connectGatewayRef = useRef<ConnectGateway>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageListRef = useRef<HTMLElement>(null);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);

  const surface = useMemo(() => getActiveSurface(canvasState), [canvasState]);
  const activeProject = useMemo(() => selectedProject(workspaceState), [workspaceState]);

  useEffect(() => {
    let cancelled = false;

    async function connectGatewaySocket(preferredGateway?: GatewayInfo) {
      try {
        const info = preferredGateway ?? (await ensureGateway());
        if (cancelled) return;
        setGateway(info);
        void refreshProviderSession(info.baseUrl);
        void refreshIdentitySession(info.baseUrl);

        wsRef.current?.close();
        const ws = new WebSocket(info.wsUrl);
        wsRef.current = ws;
        ws.onopen = () => {
          reconnectAttemptRef.current = 0;
          setGatewayStatus("ready");
        };
        ws.onmessage = (message) => handleGatewayEvent(parseGatewayEvent(String(message.data)));
        ws.onclose = () => {
          if (cancelled) return;
          setGatewayStatus("offline");
          const delayMs = Math.min(5000, 500 * 2 ** reconnectAttemptRef.current);
          reconnectAttemptRef.current += 1;
          window.clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = window.setTimeout(() => {
            void connectGatewaySocket();
          }, delayMs);
        };
        ws.onerror = () => setGatewayStatus("degraded");
      } catch (error) {
        if (cancelled) return;
        setGatewayStatus("degraded");
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = window.setTimeout(() => {
          void connectGatewaySocket();
        }, 1500);
        console.error(error);
      }
    }

    connectGatewayRef.current = connectGatewaySocket;

    void connectGatewaySocket();

    return () => {
      cancelled = true;
      flushMessageDeltas();
      if (rafRef.current) {
        window.cancelAnimationFrame(rafRef.current);
      }
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      connectGatewayRef.current = undefined;
      wsRef.current?.close();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadLegalConsent() {
      try {
        const stored = await readLegalConsentFromApp();
        const verified = parseLegalConsentRecord(stored ? JSON.stringify(stored) : undefined);
        if (cancelled || !verified) return;
        writeLegalConsentRecord(verified);
        setLegalConsent(verified);
        setQuickSetupOpen(!readQuickSetupCompleted());
      } catch {
        // Browser fallback already uses localStorage.
      }
    }

    void loadLegalConsent();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!identitySession.authenticated) {
      setIdentityPanelOpen(true);
    } else {
      setIdentityPanelOpen(false);
    }
  }, [identitySession.authenticated]);

  useEffect(() => {
    const container = messageListRef.current;
    if (!container) return;
    const scrollToBottom = () => {
      container.scrollTop = container.scrollHeight;
    };
    scrollToBottom();
    const frame = window.requestAnimationFrame(scrollToBottom);
    return () => window.cancelAnimationFrame(frame);
  }, [messages]);

  function trimMessages(items: ChatMessage[]): ChatMessage[] {
    return items.length > maxMessages ? items.slice(items.length - maxMessages) : items;
  }

  function flushMessageDeltas() {
    if (deltaBufferRef.current.size === 0) return;
    const deltas = new Map(deltaBufferRef.current);
    deltaBufferRef.current.clear();
    if (rafRef.current) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = undefined;
    }

    setMessages((current) => {
      let next = current;
      for (const [messageId, delta] of deltas) {
        const existing = next.find((message) => message.id === messageId);
        if (!existing) {
          next = [...next, { id: messageId, role: "agent", content: delta }];
        } else {
          next = next.map((message) =>
            message.id === messageId ? { ...message, content: message.content + delta } : message,
          );
        }
      }
      return trimMessages(next);
    });
  }

  function scheduleMessageFlush() {
    if (rafRef.current) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = undefined;
      flushMessageDeltas();
    });
  }

  async function refreshProviderSession(baseUrl = gateway?.baseUrl) {
    if (!baseUrl) return;
    try {
      const response = await fetch(`${baseUrl}/provider/status`);
      if (response.ok) {
        setProviderSession((await response.json()) as ProviderSession);
      }
    } catch {
      setProviderSession(defaultProviderSession);
    }
  }

  async function refreshIdentitySession(baseUrl = gateway?.baseUrl) {
    if (!baseUrl) return;
    try {
      const response = await fetch(`${baseUrl}/identity/session`);
      if (response.ok) {
        const next = (await response.json()) as IdentitySession;
        setIdentitySession({
          ...next,
          mode: readableMode(next.mode),
        });
      }
    } catch {
      setIdentitySession(defaultIdentitySession());
    }
  }

  function handleGatewayEvent(event: GatewayEvent) {
    if (event.type === "agent.message.delta") {
      deltaBufferRef.current.set(event.messageId, (deltaBufferRef.current.get(event.messageId) ?? "") + event.delta);
      scheduleMessageFlush();
      return;
    }

    if (event.type === "agent.message.done") {
      flushMessageDeltas();
      setMessages((current) =>
        current.map((message) => (message.id === event.messageId ? { ...message, done: true } : message)),
      );
      return;
    }

    if (event.type === "canvas.begin" || event.type === "canvas.patch" || event.type === "canvas.data") {
      dispatchCanvas(event);
      return;
    }

    if (event.type === "permission.request") {
      setPendingPermission(event);
      return;
    }

    if (event.type === "gateway.status") {
      setGatewayStatus(event.status);
    }
  }

  async function readImageAttachment(file: File): Promise<ComposerAttachment | null> {
    if (!file.type.startsWith("image/")) return null;
    const previewUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    }).catch(() => "");
    if (!previewUrl) return null;
    return {
      id: `${Date.now()}-${file.name}`,
      name: file.name || "pasted-image.png",
      mimeType: file.type,
      previewUrl,
      dataUrl: previewUrl,
      sizeBytes: file.size,
    };
  }

  async function appendImageAttachments(files: File[]) {
    const nextAttachments = (await Promise.all(files.map((file) => readImageAttachment(file)))).filter(
      (item): item is ComposerAttachment => Boolean(item),
    );
    if (nextAttachments.length === 0) return;
    setAttachments((current) => [...current, ...nextAttachments].slice(-6));
  }

  function removeAttachment(id: string) {
    setAttachments((current) => current.filter((item) => item.id !== id));
  }

  async function handleAttachmentSelection(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    await appendImageAttachments(files);
    event.target.value = "";
  }

  async function handleComposerPaste(event: React.ClipboardEvent<HTMLInputElement>) {
    const files = Array.from(event.clipboardData.files ?? []);
    if (files.length === 0) return;
    event.preventDefault();
    await appendImageAttachments(files);
  }

  async function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = prompt.trim();
    if ((!text && attachments.length === 0) || !gateway || !identitySession.authenticated) return;

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      try {
        const info = await ensureGateway();
        await connectGatewayRef.current?.(info);
      } catch {
        setGatewayStatus("degraded");
      }
    }

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text || "已附加圖片",
      done: true,
      attachments,
    };

    setMessages((current) => trimMessages([...current, userMessage]));
    setPrompt("");
    setAttachments([]);

    await fetch(`${gateway.baseUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId,
        prompt: text,
        attachments: userMessage.attachments?.map((item) => ({
          name: item.name,
          mimeType: item.mimeType,
          dataUrl: item.dataUrl,
          sizeBytes: item.sizeBytes,
        })),
      }),
    });
  }

  function submitPromptFromKeyboard(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  async function decidePermission(allowed: boolean) {
    if (!pendingPermission) return;
    const result = serializePermissionResult(
      pendingPermission.requestId,
      allowed,
      allowed ? t("app.permission.allowed") : t("app.permission.denied"),
    );
    setPendingPermission(undefined);
    await sendPermissionResult(result);
  }

  function onIdentitySessionChange(next: IdentitySession) {
    setIdentitySession({
      ...next,
      mode: readableMode(next.mode),
    });
    if (next.authenticated) {
      setIdentityPanelOpen(false);
    } else {
      setIdentityPanelOpen(true);
    }
  }

  async function acceptLegalConsent(record: LegalConsentRecord) {
    writeLegalConsentRecord(record);
    try {
      await writeLegalConsentToApp(record);
    } catch {
      // Browser fallback and localStorage still preserve the consent record.
    }
    setLegalConsent(record);
    setQuickSetupOpen(!readQuickSetupCompleted());
  }

  function completeQuickSetup() {
    writeQuickSetupCompleted();
    setQuickSetupOpen(false);
  }

  const gatewayStatusLabelMap: Record<"starting" | "ready" | "degraded" | "offline", string> = {
    starting: t("app.status.gatewayStarting"),
    ready: t("app.status.gatewayReady"),
    degraded: t("app.status.gatewayDegraded"),
    offline: t("app.status.gatewayOffline"),
  };
  const gatewayModeLabel: Record<GatewayInfo["mode"], string> = {
    sidecar: t("app.session.gatewayMode.sidecar"),
    external: t("app.session.gatewayMode.external"),
    "browser-dev": t("app.session.gatewayMode.browser-dev"),
  };

  const shellClassName = [
    "app-shell",
    leftPaneCollapsed ? "left-collapsed" : "",
    rightPaneCollapsed ? "right-collapsed" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const shellStyle: CSSProperties = {
    "--left-pane-width": `${leftPaneCollapsed ? 40 : 280}px`,
    "--right-pane-width": `${rightPaneCollapsed ? 40 : 420}px`,
  } as React.CSSProperties;

  return (
    <main className={shellClassName} style={shellStyle}>
      {!leftPaneCollapsed ? <WorkspacePanel state={workspaceState} dispatch={dispatchWorkspace} /> : <aside className="workspace-pane-collapsed" />}
      <aside className="conversation-pane">
        <header className="topbar">
          <div className="brand" data-tauri-drag-region>
            <Bot size={24} />
            <div>
              <h1>{t("app.brand")}</h1>
              <span>{activeProject?.name ?? t("app.subtitle")}</span>
            </div>
          </div>
            <div className="topbar-actions">
              <button
                className={`icon-button ${leftPaneCollapsed ? "active" : ""}`}
                type="button"
                aria-label={leftPaneCollapsed ? t("app.sidebar.left.expand") : t("app.sidebar.left.collapse")}
                title={leftPaneCollapsed ? t("app.sidebar.left.expand") : t("app.sidebar.left.collapse")}
                onClick={() => setLeftPaneCollapsed((current) => !current)}
              >
                <Sidebar size={18} />
              </button>
              <button
                className={`icon-button ${rightPaneCollapsed ? "active" : ""}`}
                type="button"
                aria-label={rightPaneCollapsed ? t("app.sidebar.right.expand") : t("app.sidebar.right.collapse")}
                title={rightPaneCollapsed ? t("app.sidebar.right.expand") : t("app.sidebar.right.collapse")}
                onClick={() => setRightPaneCollapsed((current) => !current)}
              >
                <SquareSplitHorizontal size={18} />
              </button>
              <label className="locale-switcher" aria-label={t("app.localeSelector")}>
              <select
                value={preference}
                onChange={(event) => {
                  setLocale(event.target.value as LocalePreference);
                }}
              >
                {supportedLocales.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="icon-button"
              type="button"
              aria-label={t("app.topbar.identity")}
              onPointerDown={(event) => {
                event.stopPropagation();
                setIdentityPanelOpen(true);
              }}
              onClick={() => setIdentityPanelOpen(true)}
            >
              <User size={18} />
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label={t("app.topbar.mcp")}
              onPointerDown={(event) => {
                event.stopPropagation();
                setMcpPanelOpen(true);
              }}
              onClick={() => setMcpPanelOpen(true)}
            >
              <PlugZap size={18} />
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label={t("app.topbar.settings")}
              onPointerDown={(event) => {
                event.stopPropagation();
                setProviderPanelOpen(true);
              }}
              onClick={() => setProviderPanelOpen(true)}
            >
              <Settings2 size={18} />
            </button>
          </div>
        </header>

        <section className="session-strip">
          <div>
            <Cable size={16} />
            <span>{gateway ? gatewayModeLabel[gateway.mode] : t("app.status.gatewayStarting")}</span>
          </div>
          <div>
            <LockKeyhole size={16} />
            <span>{t("app.session.precheck")}</span>
          </div>
          <div>
            <Laptop size={16} />
            <span>{t("app.session.platform")}</span>
          </div>
          <button
            className="session-button"
            type="button"
            data-testid="session-button-mcp"
            onClick={() => setMcpPanelOpen(true)}
            disabled={!identitySession.authenticated}
          >
            <PlugZap size={16} />
            <span>{t("app.button.mcp")}</span>
          </button>
          <Tooltip text={t("app.section.targets.desc")}>
            <button
              className="session-button"
              type="button"
              data-testid="session-button-targets"
              onClick={() => setTargetRegistryPanelOpen(true)}
              disabled={!identitySession.authenticated}
            >
              <Server size={16} />
              <span>{t("app.button.targets")}</span>
            </button>
          </Tooltip>
          <Tooltip text={t("app.section.license.desc")}>
            <button
              className="session-button"
              type="button"
              data-testid="session-button-license"
              onClick={() => setLicensePanelOpen(true)}
              disabled={!identitySession.authenticated}
            >
              <KeyRound size={16} />
              <span>{t("app.button.license")}</span>
            </button>
          </Tooltip>
          <Tooltip text={t("app.section.channels.desc")}>
            <button
              className="session-button"
              type="button"
              data-testid="session-button-channels"
              onClick={() => setChannelsPanelOpen(true)}
              disabled={!identitySession.authenticated}
            >
              <MessagesSquare size={16} />
              <span>{t("app.button.channels")}</span>
            </button>
          </Tooltip>
          <Tooltip text={t("app.section.accounts.desc")}>
            <button
              className="session-button"
              type="button"
              data-testid="session-button-accounts"
              onClick={() => setAccountsPanelOpen(true)}
              disabled={!identitySession.authenticated}
            >
              <UserRoundCog size={16} />
              <span>{t("app.button.accounts")}</span>
            </button>
          </Tooltip>
          <Tooltip text={t("app.section.workflow.desc")}>
            <button
              className="session-button"
              type="button"
              data-testid="session-button-workflow"
              onClick={() => setWorkflowPanelOpen(true)}
              disabled={!identitySession.authenticated}
            >
              <Workflow size={16} />
              <span>{t("app.button.workflow")}</span>
            </button>
          </Tooltip>
          <Tooltip text={t("app.section.media.desc")}>
            <button
              className="session-button"
              type="button"
              data-testid="session-button-media"
              onClick={() => setMediaPanelOpen(true)}
              disabled={!identitySession.authenticated}
            >
              <Film size={16} />
              <span>{t("app.button.media")}</span>
            </button>
          </Tooltip>
          <Tooltip text={t("app.section.learning.desc")}>
            <button
              className="session-button"
              type="button"
              data-testid="session-button-learning"
              onClick={() => setLearningPanelOpen(true)}
              disabled={!identitySession.authenticated}
            >
              <BrainCircuit size={16} />
              <span>{t("app.button.learning")}</span>
            </button>
          </Tooltip>
          <Tooltip text={t("app.section.memory.desc")}>
            <button
              className="session-button"
              type="button"
              data-testid="session-button-memory"
              onClick={() => setMemoryPanelOpen(true)}
              disabled={!identitySession.authenticated}
            >
              <Database size={16} />
              <span>{t("app.button.memory")}</span>
            </button>
          </Tooltip>
          <Tooltip text={t("app.section.agents.desc")}>
            <button
              className="session-button"
              type="button"
              data-testid="session-button-agents"
              onClick={() => setAgentsPanelOpen(true)}
              disabled={!identitySession.authenticated}
            >
              <UsersRound size={16} />
              <span>{t("app.button.agents")}</span>
            </button>
          </Tooltip>
          <Tooltip text={t("app.section.security.desc")}>
            <button
              className="session-button"
              type="button"
              data-testid="session-button-security"
              onClick={() => setSecurityPanelOpen(true)}
              disabled={!identitySession.authenticated}
            >
              <FolderLock size={16} />
              <span>{t("app.button.security")}</span>
            </button>
          </Tooltip>
          <Tooltip text={t("app.section.diagnostics.desc")}>
            <button
              className="session-button"
              type="button"
              data-testid="session-button-diagnostics"
              onClick={() => setDiagnosticsPanelOpen(true)}
              disabled={!identitySession.authenticated}
            >
              <Stethoscope size={16} />
              <span>{t("app.button.diagnostics")}</span>
            </button>
          </Tooltip>
          <Tooltip text={t("app.section.ergonomics.desc")}>
            <button
              className="session-button"
              type="button"
              data-testid="session-button-ergonomics"
              onClick={() => setErgonomicsPanelOpen(true)}
              disabled={!identitySession.authenticated}
            >
              <ClipboardCheck size={16} />
              <span>{t("app.button.ergonomics")}</span>
            </button>
          </Tooltip>
          <Tooltip text={t("app.section.comparison.desc")}>
            <button
              className="session-button"
              type="button"
              data-testid="session-button-comparison"
              onClick={() => setComparisonPanelOpen(true)}
              disabled={!identitySession.authenticated}
            >
              <Scale size={16} />
              <span>{t("app.button.comparison")}</span>
            </button>
          </Tooltip>
          <Tooltip text={t("app.section.coding.desc")}>
            <button
              className="session-button"
              type="button"
              data-testid="session-button-coding"
              onClick={() => setCodingWorkspacePanelOpen(true)}
              disabled={!identitySession.authenticated}
            >
              <Code2 size={16} />
              <span>{t("app.button.coding")}</span>
            </button>
          </Tooltip>
          <Tooltip text={t("app.section.context.desc")}>
            <button
              className="session-button"
              type="button"
              data-testid="session-button-context"
              onClick={() => setContextBudgetPanelOpen(true)}
              disabled={!identitySession.authenticated}
            >
              <Gauge size={16} />
              <span>{t("app.button.context")}</span>
            </button>
          </Tooltip>
          <Tooltip text={t("app.section.safetyQueue.desc")}>
            <button
              className="session-button"
              type="button"
              data-testid="session-button-safety-queue"
              onClick={() => setSafetyQueuePanelOpen(true)}
              disabled={!identitySession.authenticated}
            >
              <ShieldAlert size={16} />
              <span>{t("app.button.safetyQueue")}</span>
            </button>
          </Tooltip>
          <Tooltip text={t("app.section.compatibility.desc")}>
            <button
              className="session-button"
              type="button"
              data-testid="session-button-compatibility"
              onClick={() => setCompatSettingsOpen(true)}
              disabled={!identitySession.authenticated}
            >
              <Settings2 size={16} />
              <span>{t("app.button.compatibility")}</span>
            </button>
          </Tooltip>
          <Tooltip text={t("app.section.legal.desc")}>
            <button
              className="session-button"
              type="button"
              data-testid="session-button-legal"
              onClick={() => setLegalPanelOpen(true)}
              disabled={!identitySession.authenticated}
            >
              <Copyright size={16} />
              <span>{t("app.button.legal")}</span>
            </button>
          </Tooltip>
          <button
            className="session-button"
            type="button"
            data-testid="session-button-provider"
            onClick={() => setProviderPanelOpen(true)}
            disabled={!identitySession.authenticated}
          >
            <Settings2 size={16} />
            <span>{t("app.button.providers")}</span>
          </button>
        </section>

        <section className="message-list" aria-live="polite" ref={messageListRef}>
          {messages.map((message) => (
            <article className={`message ${message.role}`} key={message.id}>
              <span>{message.role === "user" ? t("app.status.you") : t("app.brand")}</span>
              <p>{message.content}</p>
              {message.attachments && message.attachments.length > 0 ? (
                <div className="message-attachments">
                  {message.attachments.map((attachment) => (
                    <figure className="message-attachment" key={attachment.id}>
                      <img src={attachment.previewUrl} alt={attachment.name} />
                      <figcaption>{attachment.name}</figcaption>
                    </figure>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </section>

        <input
          ref={fileInputRef}
          className="composer-file-input"
          type="file"
          accept="image/*"
          multiple
          onChange={handleAttachmentSelection}
        />
        <form className="composer" onSubmit={submitPrompt}>
          {attachments.length > 0 ? (
            <div className="composer-attachments">
              {attachments.map((attachment) => (
                <figure className="composer-attachment" key={attachment.id}>
                  <img src={attachment.previewUrl} alt={attachment.name} />
                  <figcaption>{attachment.name}</figcaption>
                  <button className="icon-button attachment-remove" type="button" onClick={() => removeAttachment(attachment.id)}>
                    <X size={14} />
                  </button>
                </figure>
              ))}
            </div>
          ) : null}
          <button className="secondary-button composer-attach-button" type="button" onClick={() => fileInputRef.current?.click()}>
            <ImagePlus size={16} />
          </button>
          <input
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={t("app.prompt.placeholder")}
            onKeyDown={submitPromptFromKeyboard}
            onPaste={(event) => void handleComposerPaste(event)}
          />
          <button className="send-button" type="submit" disabled={(!prompt.trim() && attachments.length === 0) || !gateway || !identitySession.authenticated}>
            <Send size={17} />
          </button>
        </form>
      </aside>

      {!rightPaneCollapsed ? (
        <section className="canvas-pane">
          <CanvasRenderer surface={surface} />
        </section>
      ) : (
        <section className="canvas-pane-collapsed" />
      )}

      <footer className="status-bar">
        <div className={`status-pill ${gatewayStatus}`}>
          {gatewayStatus === "ready" ? <CircleCheck size={15} /> : <CircleAlert size={15} />}
          <span>Gateway {gatewayStatusLabelMap[gatewayStatus]}</span>
        </div>
        <div className="status-pill">
          <User size={14} />
          <span>{identitySession.authenticated ? `${identitySession.displayName} · ${identitySession.mode}` : t("app.status.notAuthenticated")}</span>
        </div>
        {identitySession.authenticated && identitySession.isDeveloper ? (
          <div className="status-pill developer">
            <ShieldCheck size={14} />
            <span>{t("app.status.developerEnabled")}</span>
          </div>
        ) : null}
        <div className="status-pill">
          <Bot size={15} />
          <span>
            {providerSession.displayName} · {providerStatusLabel(providerSession.status)}
          </span>
        </div>
        <span>{gateway?.baseUrl ?? t("app.status.findingGateway")}</span>
      </footer>

      <PermissionModal request={pendingPermission} onDecision={decidePermission} />
      {accountsPanelOpen ? <AccountsPanel gatewayBaseUrl={gateway?.baseUrl} onClose={() => setAccountsPanelOpen(false)} /> : null}
      {mcpPanelOpen ? <McpPanel gatewayBaseUrl={gateway?.baseUrl} onClose={() => setMcpPanelOpen(false)} /> : null}
      {targetRegistryPanelOpen ? (
        <TargetRegistryPanel gatewayBaseUrl={gateway?.baseUrl} onClose={() => setTargetRegistryPanelOpen(false)} />
      ) : null}
      {channelsPanelOpen ? <ChannelsPanel gatewayBaseUrl={gateway?.baseUrl} onClose={() => setChannelsPanelOpen(false)} /> : null}
      {workflowPanelOpen ? <WorkflowPanel gatewayBaseUrl={gateway?.baseUrl} onClose={() => setWorkflowPanelOpen(false)} /> : null}
      {mediaPanelOpen ? <MediaPanel gatewayBaseUrl={gateway?.baseUrl} onClose={() => setMediaPanelOpen(false)} /> : null}
      {learningPanelOpen ? <LearningPanel gatewayBaseUrl={gateway?.baseUrl} onClose={() => setLearningPanelOpen(false)} /> : null}
      {licensePanelOpen ? (
        <LicensePanel
          gatewayBaseUrl={gateway?.baseUrl}
          identityEmail={identitySession.email}
          onClose={() => setLicensePanelOpen(false)}
        />
      ) : null}
      {legalPanelOpen ? (
        <LegalPanel
          gatewayBaseUrl={gateway?.baseUrl}
          legalConsent={legalConsent}
          onClose={() => setLegalPanelOpen(false)}
        />
      ) : null}
      {diagnosticsPanelOpen ? (
        <DiagnosticsPanel
          gatewayBaseUrl={gateway?.baseUrl}
          legalConsent={legalConsent}
          onClose={() => setDiagnosticsPanelOpen(false)}
        />
      ) : null}
      {memoryPanelOpen ? <MemoryPanel gatewayBaseUrl={gateway?.baseUrl} onClose={() => setMemoryPanelOpen(false)} /> : null}
      {agentsPanelOpen ? <AgentsPanel gatewayBaseUrl={gateway?.baseUrl} onClose={() => setAgentsPanelOpen(false)} /> : null}
      {ergonomicsPanelOpen ? <ErgonomicsPanel gatewayBaseUrl={gateway?.baseUrl} onClose={() => setErgonomicsPanelOpen(false)} /> : null}
      {comparisonPanelOpen ? <ComparisonPanel gatewayBaseUrl={gateway?.baseUrl} onClose={() => setComparisonPanelOpen(false)} /> : null}
      {codingWorkspacePanelOpen ? (
        <CodingWorkspacePanel gatewayBaseUrl={gateway?.baseUrl} onClose={() => setCodingWorkspacePanelOpen(false)} />
      ) : null}
      {contextBudgetPanelOpen ? <ContextBudgetPanel gatewayBaseUrl={gateway?.baseUrl} onClose={() => setContextBudgetPanelOpen(false)} /> : null}
      {safetyQueuePanelOpen ? <SafetyQueuePanel gatewayBaseUrl={gateway?.baseUrl} onClose={() => setSafetyQueuePanelOpen(false)} /> : null}
      {quickSetupOpen && legalConsent ? (
        <QuickSetupModal
          policy={sandboxPolicy}
          onPolicyChange={setSandboxPolicy}
          onOpenLicense={() => setLicensePanelOpen(true)}
          onClose={completeQuickSetup}
        />
      ) : null}
      {identityPanelOpen ? (
        <IdentityPanel
          session={identitySession}
          gatewayBaseUrl={gateway?.baseUrl}
          onClose={() => setIdentityPanelOpen(false)}
          onSessionChange={onIdentitySessionChange}
        />
      ) : null}
      {securityPanelOpen ? (
        <SecurityPanel policy={sandboxPolicy} onPolicyChange={setSandboxPolicy} onClose={() => setSecurityPanelOpen(false)} />
      ) : null}
      {compatSettingsOpen ? (
        <CompatSettingsPanel
          policy={sandboxPolicy}
          onPolicyChange={setSandboxPolicy}
          onClose={() => setCompatSettingsOpen(false)}
        />
      ) : null}
      {providerPanelOpen ? (
        <ProviderPanel
          session={providerSession}
          gatewayBaseUrl={gateway?.baseUrl}
          onClose={() => setProviderPanelOpen(false)}
          onSessionChange={setProviderSession}
        />
      ) : null}
      {!legalConsent ? <LegalConsentModal onAccept={acceptLegalConsent} /> : null}
    </main>
  );
}
