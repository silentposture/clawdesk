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
import { Tooltip } from "./Tooltip";

interface AccountsPanelProps {
  gatewayBaseUrl?: string;
  onClose: () => void;
}

const roleLabels: Record<AccountLoginDraft["role"], string> = {
  owner: "擁有者",
  admin: "管理員",
  editor: "編輯者",
  viewer: "檢視者",
  automation: "自動化服務帳號",
};

export function AccountsPanel({ gatewayBaseUrl, onClose }: AccountsPanelProps): JSX.Element {
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [provider, setProvider] = useState<AccountProvider>("google");
  const [email, setEmail] = useState("member@example.com");
  const [role, setRole] = useState<AccountLoginDraft["role"]>("editor");
  const [projectIds, setProjectIds] = useState("openclaw-desktop");
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
      setError("無法讀取帳號授權清單。");
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
      setError("帳號授權建立失敗。");
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
            <h2 id="accounts-title">帳號與協作授權中心</h2>
            <p>用 Email 與帳號授權，把人員、專案、指定軟體和自動化工作流綁在一起。MVP 不保存密碼或真 token。</p>
          </div>
          <button className="icon-button" type="button" aria-label="關閉" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="accounts-layout">
          <section className="account-form">
            <h3>新增協作帳號</h3>
            <label>
              <span>入口</span>
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
              <span>Email / 帳號</span>
              <input value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label>
              <span>協作角色</span>
              <select value={role} onChange={(event) => setRole(event.target.value as AccountLoginDraft["role"])}>
                {Object.entries(roleLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>綁定專案</span>
              <input value={projectIds} onChange={(event) => setProjectIds(event.target.value)} />
            </label>
            <label>
              <span>指定軟體 / 服務</span>
              <input value={softwareTargets} onChange={(event) => setSoftwareTargets(event.target.value)} />
            </label>
          </section>

          <section className="account-scopes">
            <h3>授權範圍</h3>
            {scopes.map((scope) => (
              <Tooltip key={scope.id} text={scope.description}>
                <label className="scope-row">
                  <ShieldCheck size={17} />
                  <span>
                    <strong>{scope.label}</strong>
                    <small>{scope.id} · 風險 {scope.risk}</small>
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
              建立授權預覽
            </button>
            {preview ? (
              <div className="account-preview">
                <span>授權預覽</span>
                <strong>{preview.title}</strong>
                <p>{preview.summary}</p>
                <small>{preview.requiresApproval ? "需要管理者或擁有者確認" : "低風險授權"}</small>
              </div>
            ) : null}
            {error ? <p className="panel-error">{error}</p> : null}
          </section>

          <section className="connected-accounts">
            <h3>目前協作者</h3>
            {accounts.length === 0 ? <p className="empty-note">尚未建立授權帳號。</p> : null}
            {accounts.map((account) => (
              <article key={account.id}>
                <UsersRound size={18} />
                <div>
                  <strong>{account.displayName}</strong>
                  <span>{account.email} · {roleLabels[account.role]} · {account.status}</span>
                  <small>{account.projectIds.join(", ")} · {account.softwareTargets.join(", ") || "未指定軟體"}</small>
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
