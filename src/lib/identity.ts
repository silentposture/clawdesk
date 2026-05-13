export type IdentityMode = "個人版" | "企業版";

export type IdentityRole = "owner" | "admin" | "member" | "viewer";

export interface IdentitySession {
  authenticated: boolean;
  userId?: string;
  displayName: string;
  email?: string;
  mode: IdentityMode;
  role: IdentityRole;
  isDeveloper?: boolean;
  emailVerified?: boolean;
  emailVerificationPending?: boolean;
  organization?: string;
  ssoProvider?: IdentitySsoProvider | "none";
  lastLoginAt?: string;
}

export type IdentitySsoProvider =
  | "apple"
  | "azure"
  | "google"
  | "google-workspace"
  | "microsoft"
  | "okta"
  | "saml"
  | "github";

export interface IdentityDraft {
  email: string;
  password: string;
  displayName?: string;
  mode: "personal" | "enterprise";
  organization?: string;
}

export interface IdentityLoginDraft {
  email: string;
  password: string;
}

export interface IdentitySsoDraft {
  provider: IdentitySsoProvider;
  email?: string;
  displayName?: string;
  organization?: string;
}

export const identitySsoProviderLabels: Record<NonNullable<IdentitySsoDraft["provider"]>, string> = {
  apple: "Apple",
  azure: "Microsoft Entra ID（Azure）",
  google: "Google",
  "google-workspace": "Google Workspace",
  microsoft: "Microsoft",
  okta: "Okta",
  saml: "SAML / OIDC SSO",
  github: "GitHub",
};

export const identitySsoProviders: IdentitySsoProvider[] = [
  "google",
  "microsoft",
  "apple",
  "google-workspace",
  "azure",
  "saml",
  "okta",
  "github",
];

export const identityModes: Array<{
  id: "personal" | "enterprise";
  name: string;
  description: string;
}> = [
  {
    id: "personal",
    name: "個人版",
    description: "可直接使用帳號與密碼登入，支援後續連到團隊專案。",
  },
  {
    id: "enterprise",
    name: "企業版",
    description: "企業可用同一入口集中管理，後續切到單一 SSO。",
  },
];

export const identityRoleLabels: Record<IdentityRole, string> = {
  owner: "擁有者",
  admin: "管理員",
  member: "一般成員",
  viewer: "檢視者",
};

export function defaultIdentitySession(): IdentitySession {
  return {
    authenticated: false,
    displayName: "未登入",
    role: "viewer",
    isDeveloper: false,
    mode: "個人版",
    ssoProvider: "none",
    emailVerified: false,
    emailVerificationPending: false,
  };
}

export function readableMode(mode: "personal" | "enterprise" | IdentityMode): IdentityMode {
  return mode === "enterprise" ? "企業版" : "個人版";
}

export function normalizeIdentityMode(mode?: "personal" | "enterprise" | IdentityMode): IdentityMode {
  return mode === "enterprise" || mode === "企業版" ? "企業版" : "個人版";
}
