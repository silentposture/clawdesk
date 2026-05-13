import { FormEvent, useMemo, useState } from "react";
import { KeyRound, MonitorCog, Shield, Sparkles, X } from "lucide-react";
import type { LlmProviderSpec, ProviderSession } from "../lib/providers";
import {
  canonicalProviderForSession,
  llmProviderCatalog,
  openClawUpstreamSnapshot,
  providerName,
  providerStatusLabel,
} from "../lib/providers";
import { useI18n } from "../lib/i18n";

interface ProviderPanelProps {
  session: ProviderSession;
  gatewayBaseUrl?: string;
  onClose: () => void;
  onSessionChange: (session: ProviderSession) => void;
}

const quickProviderIds = new Set(["chatgpt-pro", "openai-api", "google-gemini", "local-model", "mock"]);
const quickProviders = llmProviderCatalog.filter((provider) => quickProviderIds.has(provider.id));
const advancedProviders = llmProviderCatalog.filter((provider) => !quickProviderIds.has(provider.id));

function nextState(providerId: string | null | undefined, fallback = "mock"): string {
  if (!providerId) return fallback;
  const found = llmProviderCatalog.find((provider) => provider.id === providerId);
  return found ? providerId : fallback;
}

export function ProviderPanel({
  session,
  gatewayBaseUrl,
  onClose,
  onSessionChange,
}: ProviderPanelProps): JSX.Element {
  const { t } = useI18n();
  const [apiKey, setApiKey] = useState("");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [chatGptAccount, setChatGptAccount] = useState(session.accountEmail ?? "");
  const [chatGptModel, setChatGptModel] = useState(session.model ?? "gpt-5.4");
  const [openAiModel, setOpenAiModel] = useState(session.model ?? "gpt-5.2");
  const [geminiModel, setGeminiModel] = useState(session.model ?? "gemini-1.5-flash");
  const [localEndpoint, setLocalEndpoint] = useState(session.endpoint ?? "http://127.0.0.1:11434");
  const [localModel, setLocalModel] = useState(session.model ?? "llama3.2");
  const [advancedProvider, setAdvancedProvider] = useState<string>(nextState(advancedProviders[0]?.id));
  const [advancedModel, setAdvancedModel] = useState<string>(llmProviderCatalog[0]?.modelDefault ?? "");
  const [advancedAccount, setAdvancedAccount] = useState("");
  const [advancedKey, setAdvancedKey] = useState("");
  const [advancedEndpoint, setAdvancedEndpoint] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const advancedSpec = useMemo<LlmProviderSpec>(() => {
    return (
      advancedProviders.find((provider) => provider.id === advancedProvider) ?? {
        id: "anthropic",
        shortName: "Anthropic",
        displayName: "Anthropic",
        authMode: "api-key",
        modelPlaceholder: "claude-opus-4-6",
        modelDefault: "claude-opus-4-6",
        keyPlaceholder: "sk-ant-...",
        description: "Anthropic 供應商。",
      }
    );
  }, [advancedProvider]);

  async function callProviderEndpoint(path: string, body: Record<string, string>) {
    if (!gatewayBaseUrl) return null;
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(`${gatewayBaseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        return null;
      }
      const next = (await response.json()) as ProviderSession;
      onSessionChange({ ...next, activeProvider: canonicalProviderForSession(next.activeProvider) });
      return next;
    } catch {
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function configureChatGptProAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!gatewayBaseUrl || !chatGptAccount.trim()) return;
    setError(undefined);
    const response = await callProviderEndpoint("/auth/chatgpt-pro/oauth-login", {
      accountEmail: chatGptAccount.trim(),
      model: chatGptModel.trim(),
    });
    if (!response) {
      setError(t("provider.error.missingAccount"));
    } else {
      setChatGptModel(response.model ?? chatGptModel);
    }
  }

  async function connectApiKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!gatewayBaseUrl || !apiKey.trim()) return;
    setError(undefined);
    const response = await callProviderEndpoint("/auth/openai-api-key", {
      apiKey: apiKey.trim(),
      model: openAiModel.trim(),
    });
    if (!response) {
      setError(t("provider.error.apiKey"));
    } else {
      setApiKey("");
    }
  }

  async function connectGeminiApiKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!gatewayBaseUrl || !geminiApiKey.trim()) return;
    setError(undefined);
    const response = await callProviderEndpoint("/auth/gemini-api-key", {
      apiKey: geminiApiKey.trim(),
      model: geminiModel.trim(),
    });
    if (!response) {
      setError(t("provider.error.apiKey"));
    } else {
      setGeminiApiKey("");
    }
  }

  async function connectLocalModel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!gatewayBaseUrl || !localEndpoint.trim() || !localModel.trim()) return;
    setError(undefined);
    const response = await callProviderEndpoint("/auth/local-model", {
      endpoint: localEndpoint.trim(),
      model: localModel.trim(),
    });
    if (!response) {
      setError(t("provider.error.local"));
    }
  }

  async function useMockProvider() {
    if (!gatewayBaseUrl) return;
    setError(undefined);
    const response = await callProviderEndpoint("/auth/mock", {});
    if (!response) {
      setError(t("provider.error.mock"));
    }
  }

  async function configureAdvancedProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!gatewayBaseUrl || !advancedModel.trim()) return;
    setError(undefined);
    try {
      const body: Record<string, string> = {
        provider: advancedProvider,
        model: advancedModel.trim(),
      };
      if (advancedSpec.authMode === "api-key" && !advancedKey.trim()) {
        setError(t("provider.error.apiKey"));
        return;
      }
      if (advancedSpec.authMode === "oauth" && !advancedAccount.trim()) {
        setError(t("provider.error.missingAccount"));
        return;
      }
      if (advancedSpec.authMode === "local-endpoint" && !advancedEndpoint.trim()) {
        setError(t("provider.error.local"));
        return;
      }
      if (advancedSpec.authMode === "api-key") {
        body.apiKey = advancedKey.trim();
      }
      if (advancedSpec.authMode === "oauth") {
        body.accountEmail = advancedAccount.trim();
      }
      if (advancedSpec.authMode === "local-endpoint") {
        body.endpoint = advancedEndpoint.trim();
      }
      const response = await fetch(`${gatewayBaseUrl}/auth/provider`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error("configure advanced provider failed");
      }
      const next = (await response.json()) as ProviderSession;
      onSessionChange({ ...next, activeProvider: canonicalProviderForSession(next.activeProvider) });
      if (advancedSpec.authMode === "api-key") {
        setAdvancedKey("");
      }
      if (advancedSpec.authMode === "oauth") {
        setAdvancedAccount("");
      }
    } catch {
      setError(t("provider.error.apiKey"));
    } finally {
      setBusy(false);
    }
  }

  function onAdvancedProviderChange(nextProvider: string) {
    setAdvancedProvider(nextProvider);
    setAdvancedModel(advancedProviders.find((provider) => provider.id === nextProvider)?.modelDefault ?? "");
    setAdvancedEndpoint(advancedProviders.find((provider) => provider.id === nextProvider)?.endpointPlaceholder ?? "");
    setAdvancedKey("");
    setAdvancedAccount("");
  }

  return (
    <div className="panel-backdrop" role="presentation">
      <section className="provider-panel" role="dialog" aria-modal="true" aria-labelledby="provider-title">
        <header className="provider-header">
          <div>
            <h2 id="provider-title">{t("provider.title")}</h2>
            <p>{t("provider.subtitle")}</p>
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
              {providerName(session.activeProvider)} · {providerStatusLabel(session.status)}
            </strong>
            <p>{session.detail}</p>
            <small>
              OpenClaw upstream {openClawUpstreamSnapshot.commit.slice(0, 12)} · OpenAI 支援 API key 與 Codex/OAuth 帳號模式
            </small>
          </div>
        </div>

        <div className="provider-options">
          {quickProviders
            .filter((provider) => provider.id !== "mock")
            .map((provider) => {
              if (provider.id === "chatgpt-pro") {
                return (
                  <article className="provider-card" key={provider.id}>
                    <div>
                      <Sparkles size={20} />
                      <h3>{provider.shortName}</h3>
                    </div>
                    <p>{provider.description}</p>
                    <form className="stacked-form" onSubmit={configureChatGptProAccount}>
                      <input
                        value={chatGptModel}
                        onChange={(event) => setChatGptModel(event.target.value)}
                        placeholder={provider.modelPlaceholder}
                        autoComplete="off"
                      />
                      <input
                        value={chatGptAccount}
                        onChange={(event) => setChatGptAccount(event.target.value)}
                        placeholder={provider.accountPlaceholder ?? ""}
                        type="email"
                        autoComplete="email"
                      />
                      <button
                        className="secondary-button"
                        type="submit"
                        disabled={busy || !gatewayBaseUrl || !chatGptAccount.trim() || !chatGptModel.trim()}
                      >
                        <Sparkles size={16} />
                        {t("provider.chatgpt.submit")}
                      </button>
                    </form>
                  </article>
                );
              }

              if (provider.id === "openai-api") {
                return (
                  <article className="provider-card" key={provider.id}>
                    <div>
                      <KeyRound size={20} />
                      <h3>{t("provider.openai")}</h3>
                    </div>
                    <p>{t("provider.openai.description")}</p>
                    <form className="key-form" onSubmit={connectApiKey}>
                      <input
                        value={openAiModel}
                        onChange={(event) => setOpenAiModel(event.target.value)}
                        placeholder={t("provider.openai.modelPlaceholder")}
                        autoComplete="off"
                      />
                      <input
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                        placeholder={t("provider.openai.keyPlaceholder")}
                        type="password"
                        autoComplete="off"
                      />
                      <button className="secondary-button" type="submit" disabled={busy || !apiKey.trim()}>
                        {t("provider.openai.submit")}
                      </button>
                    </form>
                    {session.maskedKey ? <small>{t("provider.openai.currentKey", { key: session.maskedKey })}</small> : null}
                  </article>
                );
              }

              return (
                <article className="provider-card" key={provider.id}>
                  <div>
                    <MonitorCog size={20} />
                    <h3>{provider.id === "google-gemini" ? t("provider.gemini") : t("provider.local")}</h3>
                  </div>
                  <p>{provider.description}</p>
                  <form
                    className="stacked-form"
                    onSubmit={provider.id === "google-gemini" ? connectGeminiApiKey : connectLocalModel}
                  >
                    <input
                      value={provider.id === "google-gemini" ? geminiModel : localModel}
                      onChange={(event) =>
                        provider.id === "google-gemini" ? setGeminiModel(event.target.value) : setLocalModel(event.target.value)
                      }
                      placeholder={provider.id === "google-gemini" ? t("provider.gemini.modelPlaceholder") : t("provider.local.modelPlaceholder")}
                      autoComplete="off"
                    />
                    <input
                      value={provider.id === "google-gemini" ? geminiApiKey : localEndpoint}
                      onChange={(event) =>
                        provider.id === "google-gemini"
                          ? setGeminiApiKey(event.target.value)
                          : setLocalEndpoint(event.target.value)
                      }
                      placeholder={
                        provider.id === "google-gemini" ? t("provider.gemini.keyPlaceholder") : t("provider.local.endpointPlaceholder")
                      }
                      type={provider.id === "google-gemini" ? "password" : "text"}
                      autoComplete="off"
                    />
                    <button
                      className="secondary-button"
                      type="submit"
                      disabled={
                        busy ||
                        (provider.id === "google-gemini" ? !geminiApiKey.trim() : !localEndpoint.trim() || !localModel.trim())
                      }
                    >
                      {provider.id === "google-gemini" ? t("provider.gemini.submit") : t("provider.local.submit")}
                    </button>
                  </form>
                  {provider.id === "google-gemini" && session.maskedKey ? (
                    <small>{t("provider.gemini.currentKey", { key: session.maskedKey })}</small>
                  ) : null}
                </article>
              );
            })}

          <article className="provider-card" key="provider-mock">
            <div>
              <Shield size={20} />
              <h3>{t("provider.mock.title")}</h3>
            </div>
            <p>{t("provider.mock.description")}</p>
            <button className="secondary-button" type="button" disabled={busy} onClick={useMockProvider}>
              {t("provider.mock.submit")}
            </button>
          </article>

          <article className="provider-card">
            <div>
              <Sparkles size={20} />
              <h3>更多供應商（OpenClaw Provider 目錄）</h3>
            </div>
            <p>支援 OpenClaw 目錄中的主要供應商，可直接以 key / OAuth / endpoint 方式連線。</p>
            <form className="key-form" onSubmit={configureAdvancedProvider}>
              <select
                value={advancedProvider}
                onChange={(event) => onAdvancedProviderChange(event.target.value)}
                className="provider-provider-select"
              >
                {advancedProviders.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.shortName}
                  </option>
                ))}
              </select>
              <input
                value={advancedModel}
                onChange={(event) => setAdvancedModel(event.target.value)}
                placeholder={advancedSpec.modelPlaceholder}
                autoComplete="off"
              />
              {advancedSpec.authMode === "oauth" ? (
                <input
                  value={advancedAccount}
                  onChange={(event) => setAdvancedAccount(event.target.value)}
                  placeholder={advancedSpec.accountPlaceholder ?? `${advancedSpec.shortName} 帳號 Email`}
                  type="email"
                  autoComplete="email"
                />
              ) : null}
              {advancedSpec.authMode === "api-key" ? (
                <input
                  value={advancedKey}
                  onChange={(event) => setAdvancedKey(event.target.value)}
                  placeholder={advancedSpec.keyPlaceholder ?? `${advancedSpec.shortName} API Key`}
                  type="password"
                  autoComplete="off"
                />
              ) : null}
              {advancedSpec.authMode === "local-endpoint" ? (
                <input
                  value={advancedEndpoint}
                  onChange={(event) => setAdvancedEndpoint(event.target.value)}
                  placeholder={advancedSpec.endpointPlaceholder ?? "http://127.0.0.1:11434"}
                  autoComplete="off"
                />
              ) : null}
              <p className="provider-note">{advancedSpec.description}</p>
              <button className="secondary-button" type="submit" disabled={busy || !gatewayBaseUrl}>
                套用供應商
              </button>
            </form>
          </article>
        </div>

        {error ? <p className="provider-error">{error}</p> : null}
      </section>
    </div>
  );
}
