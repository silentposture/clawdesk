import { FormEvent, useEffect, useMemo, useState } from "react";
import { Bot, Eye, PlayCircle, RefreshCw, Shield, Trash2, X } from "lucide-react";
import type { ProviderSession } from "../lib/providers";
import { providerStatusLabel } from "../lib/providers";
import { useI18n } from "../lib/i18n";

interface ProviderPanelProps {
  session: ProviderSession;
  gatewayBaseUrl?: string;
  onClose: () => void;
  onSessionChange: (session: ProviderSession) => void;
}

interface OllamaModel {
  name: string;
  modifiedAt?: string;
  capabilities?: {
    vision?: boolean;
    text?: boolean;
    source?: string;
    reason?: string;
    probedAt?: string;
  };
}

const endpointOptions = [
  {
    id: "ollama-local",
    label: "Ollama / 本機模型 endpoint",
    endpoint: "http://127.0.0.1:11434",
  },
];

const effortOptions = [
  { value: "low", label: "Inherited: low" },
  { value: "medium", label: "Inherited: medium" },
  { value: "high", label: "Inherited: high" },
];

function modelFallback(session: ProviderSession): string {
  return session.model || "nemotron-3-super:cloud";
}

function capabilityForModel(models: OllamaModel[], modelName: string): OllamaModel["capabilities"] | undefined {
  return models.find((item) => item.name === modelName)?.capabilities;
}

function formatProbeTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function ProviderPanel({
  session,
  gatewayBaseUrl,
  onClose,
  onSessionChange,
}: ProviderPanelProps): JSX.Element {
  const { t } = useI18n();
  const [endpoint, setEndpoint] = useState(session.endpoint ?? endpointOptions[0].endpoint);
  const [model, setModel] = useState(modelFallback(session));
  const [effort, setEffort] = useState("low");
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [visionTesting, setVisionTesting] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [testResult, setTestResult] = useState<string>();
  const [visionResult, setVisionResult] = useState<string>();

  const modelOptions = useMemo(() => {
    const names = models.map((item) => item.name).filter(Boolean);
    return [...new Set([model, ...names])].filter(Boolean);
  }, [model, models]);
  const selectedCapability = capabilityForModel(models, model);

  useEffect(() => {
    setEndpoint(session.endpoint ?? endpointOptions[0].endpoint);
    setModel(modelFallback(session));
  }, [session.endpoint, session.model]);

  useEffect(() => {
    void refreshModels(endpoint);
  }, [gatewayBaseUrl]);

  async function refreshModels(nextEndpoint = endpoint) {
    if (!gatewayBaseUrl || !nextEndpoint.trim()) return;
    setError(undefined);
    setMessage(undefined);
    setTestResult(undefined);
    setVisionResult(undefined);
    try {
      const response = await fetch(
        `${gatewayBaseUrl}/provider/local-model/models?endpoint=${encodeURIComponent(nextEndpoint.trim())}`,
      );
      const payload = (await response.json()) as { models?: OllamaModel[]; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Cannot load models");
      }
      const nextModels = payload.models ?? [];
      setModels(nextModels);
      if (nextModels.length > 0 && !nextModels.some((item) => item.name === model)) {
        setModel(nextModels[0].name);
      }
      setMessage(t("provider.localModel.modelsLoaded", { count: nextModels.length }));
    } catch (caught) {
      setModels([]);
      setError(caught instanceof Error ? caught.message : t("provider.localModel.modelLoadError"));
    }
  }

  async function applyLocalModelEndpoint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!gatewayBaseUrl || !endpoint.trim() || !model.trim()) return;
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const response = await fetch(`${gatewayBaseUrl}/auth/local-model`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: endpoint.trim(),
          model: model.trim(),
          effort,
        }),
      });
      const payload = (await response.json()) as ProviderSession | { error?: string };
      if (!response.ok) {
        throw new Error("error" in payload ? payload.error : "Local model endpoint setup failed");
      }
      onSessionChange(payload as ProviderSession);
      setMessage(t("provider.localModel.applied", { model: model.trim(), endpoint: endpoint.trim() }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("provider.localModel.applyError"));
    } finally {
      setBusy(false);
    }
  }

  async function testLocalModelEndpoint() {
    if (!gatewayBaseUrl || !endpoint.trim() || !model.trim()) return;
    setTesting(true);
    setError(undefined);
    setTestResult(undefined);
    try {
      const setupResponse = await fetch(`${gatewayBaseUrl}/auth/local-model`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: endpoint.trim(),
          model: model.trim(),
          effort,
        }),
      });
      const setupPayload = (await setupResponse.json()) as ProviderSession | { error?: string };
      if (!setupResponse.ok) {
        throw new Error("error" in setupPayload ? setupPayload.error : "Local model endpoint setup failed");
      }
      onSessionChange(setupPayload as ProviderSession);

      const chatResponse = await fetch(`${gatewayBaseUrl}/provider/local-model/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: endpoint.trim(),
          model: model.trim(),
          prompt: t("provider.localModel.testPrompt"),
        }),
      });
      const payload = (await chatResponse.json()) as { ok?: boolean; outputText?: string; error?: string };
      if (!chatResponse.ok || !payload.ok) {
        throw new Error(payload.error || t("provider.localModel.testFailed"));
      }
      setTestResult(payload.outputText || t("provider.localModel.testSuccess"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("provider.localModel.testError"));
    } finally {
      setTesting(false);
    }
  }

  async function testVisionCapability() {
    if (!gatewayBaseUrl || !endpoint.trim() || !model.trim()) return;
    setVisionTesting(true);
    setError(undefined);
    setVisionResult(undefined);
    try {
      const response = await fetch(`${gatewayBaseUrl}/provider/local-model/vision-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: endpoint.trim(),
          model: model.trim(),
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        vision?: boolean;
        mode?: string;
        outputText?: string;
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || t("provider.localModel.visionProbeError"));
      }
      const vision = Boolean(payload.vision);
      setModels((current) =>
        current.map((item) =>
          item.name === model.trim()
            ? {
                ...item,
                capabilities: {
                  ...(item.capabilities ?? {}),
                  vision,
                  text: true,
                  source: "probe",
                  reason: vision ? t("provider.localModel.visionProbeReady") : t("provider.localModel.visionProbeMetadata"),
                },
              }
            : item,
        ),
      );
      setVisionResult(vision ? t("provider.localModel.visionProbeReady") : t("provider.localModel.visionProbeMetadata"));
    } catch (caught) {
      setVisionResult(t("provider.localModel.visionProbeMetadata"));
      setError(caught instanceof Error ? caught.message : t("provider.localModel.visionProbeError"));
    } finally {
      setVisionTesting(false);
    }
  }

  async function clearVisionCapability() {
    if (!gatewayBaseUrl || !endpoint.trim() || !model.trim()) return;
    setError(undefined);
    setVisionResult(undefined);
    try {
      const response = await fetch(`${gatewayBaseUrl}/provider/local-model/vision-clear`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: endpoint.trim(),
          model: model.trim(),
        }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || t("provider.localModel.visionClearError"));
      }
      setModels((current) =>
        current.map((item) =>
          item.name === model.trim()
            ? {
                ...item,
                capabilities: {
                  ...(item.capabilities ?? {}),
                  vision: false,
                  text: true,
                  source: "heuristic",
                  probedAt: undefined,
                },
              }
            : item,
        ),
      );
      setVisionResult(t("provider.localModel.visionClearSuccess"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("provider.localModel.visionClearError"));
    }
  }

  return (
    <div className="panel-backdrop" role="presentation">
      <section className="provider-panel compat-provider-panel" role="dialog" aria-modal="true" aria-labelledby="provider-title">
        <header className="provider-header">
          <div>
            <h2 id="provider-title">{t("provider.title")}</h2>
            <p>{t("provider.localModel.subtitle")}</p>
          </div>
          <button className="icon-button" type="button" aria-label={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="provider-current">
          <Shield size={18} />
          <div>
            <span>{t("provider.currentState")}</span>
            <strong>
              {session.displayName} · {providerStatusLabel(session.status)}
            </strong>
            <p>{session.detail}</p>
          </div>
        </div>

        <form className="compat-provider-flow" onSubmit={applyLocalModelEndpoint}>
          <label>
            <span>{t("provider.localModel.endpoint")}</span>
            <select
              value={endpoint}
              onChange={(event) => {
                const nextEndpoint = event.target.value;
                setEndpoint(nextEndpoint);
                void refreshModels(nextEndpoint);
              }}
            >
              {endpointOptions.map((item) => (
                <option key={item.id} value={item.endpoint}>
                  {item.label} · {item.endpoint}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>{t("provider.localModel.model")}</span>
            <select value={model} onChange={(event) => setModel(event.target.value)}>
              {modelOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <small className={selectedCapability?.vision ? "provider-capability vision" : "provider-capability text"}>
              {selectedCapability?.vision ? t("provider.localModel.visionReady") : t("provider.localModel.metadataOnly")}
            </small>
            {selectedCapability?.source === "probe" && selectedCapability.probedAt ? (
              <small className="provider-capability">{t("provider.localModel.visionLastTested", { time: formatProbeTime(selectedCapability.probedAt) })}</small>
            ) : null}
          </label>

          <label>
            <span>{t("provider.localModel.effort")}</span>
            <select value={effort} onChange={(event) => setEffort(event.target.value)}>
              {effortOptions.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <div className="compat-provider-actions">
            <button className="secondary-button" type="button" disabled={busy || !gatewayBaseUrl} onClick={() => void refreshModels()}>
              <RefreshCw size={16} />
              {t("provider.localModel.refresh")}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={busy || testing || !gatewayBaseUrl || !endpoint.trim() || !model.trim()}
              onClick={() => void testLocalModelEndpoint()}
            >
              <PlayCircle size={16} />
              {t("provider.localModel.test")}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={busy || visionTesting || !gatewayBaseUrl || !endpoint.trim() || !model.trim()}
              onClick={() => void testVisionCapability()}
            >
              <Eye size={16} />
              {t("provider.localModel.visionProbe")}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={busy || visionTesting || !gatewayBaseUrl || !endpoint.trim() || !model.trim() || selectedCapability?.source !== "probe"}
              onClick={() => void clearVisionCapability()}
            >
              <Trash2 size={16} />
              {t("provider.localModel.visionClear")}
            </button>
            <button className="primary-button" type="submit" disabled={busy || !gatewayBaseUrl || !endpoint.trim() || !model.trim()}>
              <Bot size={16} />
              {t("provider.localModel.apply")}
            </button>
          </div>
        </form>

        {models.length > 0 ? (
          <section className="compat-model-list" aria-label="Local model list">
            {models.map((item) => (
              <button
                className={item.name === model ? "model-chip selected" : "model-chip"}
                type="button"
                key={item.name}
                title={item.capabilities?.reason}
                onClick={() => setModel(item.name)}
              >
                <span>{item.name}</span>
                <small>{item.capabilities?.vision ? t("provider.localModel.visionBadge") : t("provider.localModel.textBadge")}</small>
              </button>
            ))}
          </section>
        ) : null}

        {message ? <p className="provider-note">{message}</p> : null}
        {testResult ? <p className="provider-test-result">{testResult}</p> : null}
        {visionResult ? <p className="provider-test-result">{visionResult}</p> : null}
        {error ? <p className="provider-error">{error}</p> : null}
      </section>
    </div>
  );
}
