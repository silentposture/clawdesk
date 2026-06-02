import { ArrowRight, KeyRound, LogIn, ShieldCheck, UserRoundCog, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import {
  identityModes,
  identitySsoProviderLabels,
  identityRoleLabels,
  identitySsoProviders,
  type IdentityLoginDraft,
  type IdentitySsoDraft,
  type IdentityDraft,
  type IdentitySession,
} from "../lib/identity";
import { useI18n } from "../lib/i18n";

interface IdentityPanelProps {
  session: IdentitySession;
  gatewayBaseUrl?: string;
  onClose: () => void;
  onSessionChange: (session: IdentitySession) => void;
}

type IdentityEntryMode = "signin" | "register" | "sso" | "reset";

export function IdentityPanel({ session, gatewayBaseUrl, onClose, onSessionChange }: IdentityPanelProps): JSX.Element {
  const { t } = useI18n();
  const [mode, setMode] = useState<IdentityEntryMode>("signin");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState(session.email ?? "");
  const [password, setPassword] = useState("");
  const [passwordRepeat, setPasswordRepeat] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [deploymentMode, setDeploymentMode] = useState<"personal" | "enterprise">("personal");
  const [organization, setOrganization] = useState("");
  const [ssoProvider, setSsoProvider] = useState<IdentitySsoDraft["provider"]>("google");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const sessionSsoProviderLabel =
    session.ssoProvider && session.ssoProvider !== "none"
      ? identitySsoProviderLabels[session.ssoProvider] ?? session.ssoProvider
      : "";

  useEffect(() => {
    setEmail(session.email ?? "");
    setDisplayName(session.authenticated ? session.displayName : "");
  }, [session.email, session.displayName, session.authenticated]);

  async function postIdentity(path: string, body: unknown) {
    if (!gatewayBaseUrl) {
      throw new Error("No gateway base URL");
    }
    const response = await fetch(`${gatewayBaseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok) {
      const err: Error & { payload?: unknown } = new Error(
        `Request failed: ${response.status}`,
      ) as Error & { payload?: unknown };
      err.payload = payload;
      throw err;
    }
    return payload;
  }

  async function confirmEmail() {
    if (!gatewayBaseUrl || !verificationCode.trim() || !email.trim()) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const nextSession = (await postIdentity("/identity/confirm", {
        email: email.trim(),
        code: verificationCode.trim(),
      })) as IdentitySession;
      setVerificationCode("");
      onSessionChange(nextSession);
      if (nextSession.authenticated) {
        onClose();
      }
    } catch {
      setError(t("identity.formError.invalidCode"));
    } finally {
      setBusy(false);
    }
  }

  async function fetchVerificationCode() {
    if (!gatewayBaseUrl || !email.trim()) {
      return;
    }
    try {
      const response = await fetch(
        `${gatewayBaseUrl}/identity/verification-code?email=${encodeURIComponent(email.trim().toLowerCase())}`,
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? "verification fetch failed");
      }
      const code = typeof payload.code === "string" ? payload.code : "";
      if (!code) {
        setError(t("identity.formError.codeMissing"));
        return;
      }
      setVerificationCode(code);
      setError(t("identity.formError.codeFetched"));
    } catch {
      setError(t("identity.formError.codeMissing"));
    }
  }

  async function resendVerification() {
    if (!gatewayBaseUrl || !email.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const payload = (await postIdentity("/identity/resend-verification", { email: email.trim() })) as {
        verification?: { token: string; expiresAt: string };
      };
      if (payload.verification?.token) {
        setError(t("identity.formError.codeResend"));
      }
    } catch {
      setError(t("identity.formError.codeResendFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function requestPasswordReset() {
    if (!gatewayBaseUrl || !email.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      await postIdentity("/identity/forgot-password", { email: email.trim() });
      setMode("reset");
      setError(t("identity.formError.resetRequested"));
    } catch {
      setError(t("identity.formError.resetRequestFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function fetchPasswordResetCode() {
    if (!gatewayBaseUrl || !email.trim()) {
      return;
    }
    try {
      const response = await fetch(
        `${gatewayBaseUrl}/identity/password-reset-code?email=${encodeURIComponent(email.trim().toLowerCase())}`,
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? "password reset fetch failed");
      }
      const code = typeof payload.code === "string" ? payload.code : "";
      if (!code) {
        setError(t("identity.formError.resetCodeMissing"));
        return;
      }
      setVerificationCode(code);
      setError(t("identity.formError.resetCodeFetched"));
    } catch {
      setError(t("identity.formError.resetCodeMissing"));
    }
  }

  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.includes("@") || password.length < 8 || password !== passwordRepeat || !verificationCode.trim()) {
      setError(t("identity.formError.resetInvalid"));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await postIdentity("/identity/reset-password", {
        email: email.trim(),
        code: verificationCode.trim(),
        password,
      });
      setPassword("");
      setPasswordRepeat("");
      setVerificationCode("");
      setMode("signin");
      setError(t("identity.formError.resetSuccess"));
    } catch (error) {
      const message = (error as { payload?: { error?: string } }).payload?.error;
      setError(message || t("identity.formError.resetFailed"));
    } finally {
      setBusy(false);
    }
  }

  function formatPanelTip() {
    if (session.emailVerificationPending && !session.authenticated) {
      return t("identity.formHint");
    }
    return t("identity.formError.registerHint");
  }

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!gatewayBaseUrl) return;
    if (!displayName.trim() || !email.includes("@") || password.length < 8 || password !== passwordRepeat) {
      setError(t("identity.formError.registerInvalid"));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const payload: IdentityDraft = {
        email: email.trim(),
        displayName: displayName.trim(),
        password,
        mode: deploymentMode,
      };
      if (organization.trim()) {
        payload.organization = organization.trim();
      }
      const nextSession = (await postIdentity("/identity/register", payload)) as IdentitySession;
      if (!nextSession.authenticated && nextSession.emailVerificationPending) {
        setVerificationCode("");
        setMode("register");
        setError(t("identity.formError.registerSuccess"));
        setEmail(nextSession.email ?? email);
      } else {
        onClose();
      }
      onSessionChange(nextSession);
    } catch {
      setError(t("identity.formError.registerFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.includes("@") || password.length < 1) {
      setError(t("identity.formError.signinInvalid"));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const payload: IdentityLoginDraft = {
        email: email.trim(),
        password,
      };
      const nextSession = (await postIdentity("/identity/login", payload)) as IdentitySession;
      onSessionChange(nextSession);
      onClose();
    } catch (error) {
      const message = (error as { payload?: { error?: string } }).payload?.error;
      setError(message || t("identity.formError.signinFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function ssoSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const payload: IdentitySsoDraft = { provider: ssoProvider, email: email.trim(), displayName: displayName.trim() };
      if (organization.trim()) {
        payload.organization = organization.trim();
      }
      const nextSession = (await postIdentity("/identity/sso", payload)) as IdentitySession;
      onSessionChange(nextSession);
      onClose();
    } catch {
      setError(t("identity.formError.ssoFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    if (!gatewayBaseUrl) return;
    setBusy(true);
    setError(undefined);
    try {
      const nextSession = (await postIdentity("/identity/logout", {})) as IdentitySession;
      onSessionChange(nextSession);
      if (!nextSession.authenticated) {
        onClose();
      }
    } catch {
      setError(t("identity.formError.logoutFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel-backdrop" role="presentation">
      <section className="identity-panel" role="dialog" aria-modal="true" aria-labelledby="identity-title">
      <header className="provider-header">
          <div>
            <h2 id="identity-title">{t("identity.title")}</h2>
            <p>{formatPanelTip()}</p>
          </div>
          <button className="icon-button" type="button" aria-label={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="identity-summary">
          <ShieldCheck size={18} />
          <div>
            <span>{t("identity.current")}</span>
            <strong>
              {session.authenticated ? `${session.displayName} · ${session.mode}` : t("identity.notLogged")}
            </strong>
            <small>{session.authenticated ? identityRoleLabels[session.role] : t("identity.notAuthenticated")}</small>
            {session.isDeveloper ? <small className="dev-badge">{t("identity.developerTag")}</small> : null}
          </div>
        </div>

        {session.authenticated ? (
          <div className="identity-session">
            <h3>{t("identity.authenticated")}</h3>
            <p>{t("identity.emailLabel", { value: session.email ?? "" })}</p>
            {session.organization ? <p>{t("identity.organizationLabel", { value: session.organization })}</p> : null}
            <p>{t("identity.modeValue", { label: t("identity.modeLabel"), value: session.mode })}</p>
            {sessionSsoProviderLabel ? <p>SSO：{sessionSsoProviderLabel}</p> : null}
            {session.lastLoginAt ? <p>{t("identity.lastLogin", { value: session.lastLoginAt })}</p> : null}
            <button className="secondary-button" type="button" onClick={signOut} disabled={busy}>
              <LogIn size={16} />
              {t("identity.signout")}
            </button>
          </div>
        ) : null}

        <div className="identity-tabs" role="tablist" aria-label={t("identity.title")}>
          <button
            type="button"
            role="tab"
            className={mode === "signin" ? "session-button" : ""}
            onClick={() => setMode("signin")}
            aria-selected={mode === "signin"}
          >
            <LogIn size={16} />
            {t("identity.signinTab")}
          </button>
          <button
            type="button"
            role="tab"
            className={mode === "register" ? "session-button" : ""}
            onClick={() => setMode("register")}
            aria-selected={mode === "register"}
          >
            <UserRoundCog size={16} />
            {t("identity.registerTab")}
          </button>
          <button
            type="button"
            role="tab"
            className={mode === "sso" ? "session-button" : ""}
            onClick={() => setMode("sso")}
            aria-selected={mode === "sso"}
          >
            <KeyRound size={16} />
            {t("identity.ssoTab")}
          </button>
          <button
            type="button"
            role="tab"
            className={mode === "reset" ? "session-button" : ""}
            onClick={() => setMode("reset")}
            aria-selected={mode === "reset"}
          >
            <ShieldCheck size={16} />
            {t("identity.resetTab")}
          </button>
        </div>

        {mode === "signin" ? (
          <form className="identity-form stacked-form" onSubmit={signIn}>
            <label>
              <span>{t("identity.email")}</span>
              <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" />
            </label>
            <label>
              <span>{t("identity.password")}</span>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete="current-password"
              />
            </label>
            <button className="primary-button" type="submit" disabled={busy || !gatewayBaseUrl || !email.trim() || !password.trim()}>
              <LogIn size={16} />
              {t("identity.submit.signin")}
            </button>
            <button className="secondary-button" type="button" onClick={requestPasswordReset} disabled={busy || !gatewayBaseUrl || !email.trim()}>
              <ShieldCheck size={16} />
              {t("identity.submit.requestReset")}
            </button>
          </form>
        ) : null}

        {mode === "register" ? (
          <form className="identity-form stacked-form" onSubmit={register}>
            <label>
              <span>{t("identity.displayName")}</span>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder={t("identity.displayName")}
                autoComplete="name"
              />
            </label>
            <label>
              <span>{t("identity.email")}</span>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                placeholder="name@example.com"
                autoComplete="email"
              />
            </label>
            <label>
              <span>{t("identity.deploymentMode")}</span>
              <select value={deploymentMode} onChange={(event) => setDeploymentMode(event.target.value as "personal" | "enterprise")}>
                {identityModes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t("identity.organization")}</span>
              <input
                value={organization}
                onChange={(event) => setOrganization(event.target.value)}
                placeholder={t("identity.organizationPlaceholder")}
                autoComplete="organization"
              />
            </label>
            <label>
              <span>{t("identity.password")}</span>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete="new-password"
              />
            </label>
            <label>
              <span>{t("identity.passwordRepeat")}</span>
              <input
                value={passwordRepeat}
                onChange={(event) => setPasswordRepeat(event.target.value)}
                type="password"
                autoComplete="new-password"
              />
            </label>
            <button className="primary-button" type="submit" disabled={busy || !gatewayBaseUrl || !email.trim()}>
              <UserRoundCog size={16} />
              {t("identity.submit.register")}
            </button>
          </form>
        ) : null}

        {session.emailVerificationPending && !session.authenticated ? (
          <section className="identity-verification">
            <h3>{t("identity.submit.confirm")}</h3>
            <label>
              <span>{t("identity.verificationCode")}</span>
              <input
                value={verificationCode}
                onChange={(event) => setVerificationCode(event.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
              />
            </label>
            <div className="identity-inline-actions">
              <button className="secondary-button" type="button" onClick={fetchVerificationCode} disabled={busy || !gatewayBaseUrl}>
                {t("identity.submit.fetchCode")}
              </button>
              <button className="secondary-button" type="button" onClick={resendVerification} disabled={busy || !gatewayBaseUrl}>
                {t("identity.submit.resend")}
              </button>
              <button className="primary-button" type="button" onClick={confirmEmail} disabled={busy || !verificationCode.trim()}>
                {t("identity.submit.confirm")}
              </button>
            </div>
          </section>
        ) : null}

        {mode === "sso" ? (
          <form className="identity-form stacked-form" onSubmit={ssoSignIn}>
            <label>
              <span>{t("identity.connectProvider")}</span>
              <select value={ssoProvider} onChange={(event) => setSsoProvider(event.target.value as IdentitySsoDraft["provider"])}>
                {identitySsoProviders.map((provider) => (
                  <option key={provider} value={provider}>
                    {identitySsoProviderLabels[provider]}
                  </option>
                ))}
              </select>
            </label>
            <p>{t("identity.ssoMockNotice")}</p>
            <label>
              <span>{t("identity.connectHint")}</span>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                placeholder={t("identity.bindExistingPlaceholder")}
                autoComplete="email"
              />
            </label>
            <label>
              <span>{t("identity.displayName")}</span>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder={t("identity.ssoNamePlaceholder")}
                autoComplete="name"
              />
            </label>
            <label>
              <span>{t("identity.organization")}</span>
              <input
                value={organization}
                onChange={(event) => setOrganization(event.target.value)}
                placeholder={t("identity.ssoOrganizationPlaceholder")}
              />
            </label>
            <button className="primary-button" type="submit" disabled={busy || !gatewayBaseUrl}>
              <ArrowRight size={16} />
              {t("identity.submit.connectSso")}
            </button>
          </form>
        ) : null}

        {mode === "reset" ? (
          <form className="identity-form stacked-form" onSubmit={resetPassword}>
            <label>
              <span>{t("identity.email")}</span>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                placeholder="name@example.com"
                autoComplete="email"
              />
            </label>
            <label>
              <span>{t("identity.verificationCode")}</span>
              <input
                value={verificationCode}
                onChange={(event) => setVerificationCode(event.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
              />
            </label>
            <div className="identity-inline-actions">
              <button className="secondary-button" type="button" onClick={requestPasswordReset} disabled={busy || !gatewayBaseUrl || !email.trim()}>
                {t("identity.submit.requestReset")}
              </button>
              <button className="secondary-button" type="button" onClick={fetchPasswordResetCode} disabled={busy || !gatewayBaseUrl || !email.trim()}>
                {t("identity.submit.fetchResetCode")}
              </button>
            </div>
            <label>
              <span>{t("identity.password")}</span>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete="new-password"
              />
            </label>
            <label>
              <span>{t("identity.passwordRepeat")}</span>
              <input
                value={passwordRepeat}
                onChange={(event) => setPasswordRepeat(event.target.value)}
                type="password"
                autoComplete="new-password"
              />
            </label>
            <button className="primary-button" type="submit" disabled={busy || !gatewayBaseUrl || !email.trim() || !verificationCode.trim()}>
              <ShieldCheck size={16} />
              {t("identity.submit.resetPassword")}
            </button>
          </form>
        ) : null}

        {error ? <p className="panel-error">{error}</p> : null}
      </section>
    </div>
  );
}
