import { KeyRound, ShieldCheck, UserPlus, UsersRound, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  accountProviders,
  authPreview,
  createLoginDraft,
  providerScopes,
  type AccountAuthPreview,
  type AccountLoginDraft,
  type AccountProvider,
  type ConnectedAccount,
} from "../lib/accounts";
import { useI18n } from "../lib/i18n";
import { Tooltip } from "./Tooltip";

interface AccountsPanelProps {
  gatewayBaseUrl?: string;
  onClose: () => void;
}

const roleLabelKeys: Record<AccountLoginDraft["role"], string> = {
  owner: "accounts.role.owner",
  admin: "accounts.role.admin",
  editor: "accounts.role.editor",
  viewer: "accounts.role.viewer",
  automation: "accounts.role.automation",
};

function normalizeDisplayValue(value: string): string {
  return value.replace(/openclaw/gi, "clawdesk");
}

export function AccountsPanel({ gatewayBaseUrl, onClose }: AccountsPanelProps): JSX.Element {
  const { t } = useI18n();
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [provider, setProvider] = useState<AccountProvider>("google");
  const [email, setEmail] = useState("member@example.com");
  const [role, setRole] = useState<AccountLoginDraft["role"]>("editor");
  const [projectIds, setProjectIds] = useState("clawdesk-desktop");
  const [softwareTargets, setSoftwareTargets] = useState("Google Drive, Gmail");
  const [selectedScopes, setSelectedScopes] = useState<string[]>(providerScopes("google").map((scope) => scope.id));
  const [preview, setPreview] = useState<AccountAuthPreview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const scopes = useMemo(() => providerScopes(provider), [provider]);

  useEffect(() => {
    void loadAccounts();
  }, [gatewayBaseUrl]);

  function makeDraft(): AccountLoginDraft {
    return {
      ...createLoginDraft(provider, email.trim()),
      role,
      projectIds: projectIds
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      softwareTargets: softwareTargets
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      scopes: selectedScopes,
    };
  }

  async function loadAccounts() {
    if (!gatewayBaseUrl) return;
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(`${gatewayBaseUrl}/accounts`);
      if (!response.ok) throw new Error("bad response");
      const payload = (await response.json()) as { accounts: ConnectedAccount[] };
      setAccounts(payload.accounts);
    } catch {
      setError(t("accounts.loadError"));
    } finally {
      setBusy(false);
    }
  }

  async function connectAccount() {
    if (!gatewayBaseUrl) return;
    const draft = makeDraft();
    setPreview(authPreview(draft));
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(`${gatewayBaseUrl}/accounts/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!response.ok) throw new Error("bad response");
      const payload = (await response.json()) as { preview: AccountAuthPreview };
      setPreview(payload.preview);
      await loadAccounts();
    } catch {
      setError(t("accounts.connectError"));
      setBusy(false);
    }
  }

  function toggleScope(scopeId: string) {
    setSelectedScopes((current) =>
      current.includes(scopeId) ? current.filter((item) => item !== scopeId) : [...current, scopeId],
    );
  }

  return (
    <div className="panel-backdrop" role="presentation">
      <section className="accounts-panel" role="dialog" aria-modal="true" aria-labelledby="accounts-title">
        <header className="provider-header">
          <div>
            <h2 id="accounts-title">{t("accounts.title")}</h2>
            <p>{t("accounts.subtitle")}</p>
          </div>
          <button className="icon-button" type="button" aria-label={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="accounts-layout">
          <section className="account-form">
            <h3>{t("accounts.addTitle")}</h3>
            <label>
              <span>{t("accounts.provider")}</span>
              <select
                value={provider}
                onChange={(event) => {
                  const next = event.target.value as AccountProvider;
                  setProvider(next);
                  setSelectedScopes(providerScopes(next).map((scope) => scope.id));
                }}
              >
                {accountProviders.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t("accounts.email")}</span>
              <input value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label>
              <span>{t("accounts.role")}</span>
              <select value={role} onChange={(event) => setRole(event.target.value as AccountLoginDraft["role"])}>
                {Object.entries(roleLabelKeys).map(([value, labelKey]) => (
                  <option key={value} value={value}>
                    {t(labelKey)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t("accounts.projects")}</span>
              <input value={projectIds} onChange={(event) => setProjectIds(event.target.value)} />
            </label>
            <label>
              <span>{t("accounts.software")}</span>
              <input value={softwareTargets} onChange={(event) => setSoftwareTargets(event.target.value)} />
            </label>
          </section>

          <section className="account-scopes">
            <h3>{t("accounts.scopes")}</h3>
            {scopes.map((scope) => (
              <Tooltip key={scope.id} text={scope.description}>
                <label className="scope-row">
                  <ShieldCheck size={17} />
                  <span>
                    <strong>{scope.label}</strong>
                    <small>{scope.id} · {t("accounts.risk", { risk: scope.risk })}</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={selectedScopes.includes(scope.id)}
                    onChange={() => toggleScope(scope.id)}
                  />
                </label>
              </Tooltip>
            ))}
            <button className="primary-button" type="button" disabled={busy || !email.trim()} onClick={connectAccount}>
              <UserPlus size={16} />
              {t("accounts.previewButton")}
            </button>
            {preview ? (
              <div className="account-preview">
                <span>{t("accounts.previewTitle")}</span>
                <strong>{preview.title}</strong>
                <p>{preview.summary}</p>
                <small>{preview.requiresApproval ? t("accounts.approvalRequired") : t("accounts.lowRisk")}</small>
              </div>
            ) : null}
            {error ? <p className="panel-error">{error}</p> : null}
          </section>

          <section className="connected-accounts">
            <h3>{t("accounts.current")}</h3>
            {accounts.length === 0 ? <p className="empty-note">{t("accounts.empty")}</p> : null}
            {accounts.map((account) => (
              <article key={account.id}>
                <UsersRound size={18} />
                <div>
                  <strong>{account.displayName}</strong>
                  <span>{account.email} · {t(roleLabelKeys[account.role])} · {account.status}</span>
                  <small>
                    {account.projectIds.map(normalizeDisplayValue).join(", ")} ·{" "}
                    {account.softwareTargets.map(normalizeDisplayValue).join(", ") || t("accounts.unspecifiedSoftware")}
                  </small>
                </div>
                <KeyRound size={16} />
              </article>
            ))}
          </section>
        </div>
      </section>
    </div>
  );
}
