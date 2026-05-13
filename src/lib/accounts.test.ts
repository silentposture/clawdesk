import { describe, expect, it } from "vitest";
import { accountProviders, authPreview, createLoginDraft, providerScopes } from "./accounts";

describe("multi-entry account authorization", () => {
  it("includes collaboration providers", () => {
    const providers = accountProviders.map((provider) => provider.id);
    expect(providers).toContain("google");
    expect(providers).toContain("microsoft");
    expect(providers).toContain("github");
    expect(providers).toContain("slack");
    expect(providers).toContain("email");
  });

  it("creates provider-specific login drafts", () => {
    const draft = createLoginDraft("google", "user@example.com");
    expect(draft.email).toBe("user@example.com");
    expect(draft.scopes).toContain("drive.read");
  });

  it("requires approval for high-risk scopes", () => {
    const draft = createLoginDraft("microsoft", "owner@example.com");
    expect(authPreview(draft).requiresApproval).toBe(true);
  });

  it("returns empty scopes for unknown safety fallback", () => {
    expect(providerScopes("chatgpt")).toHaveLength(2);
  });
});
