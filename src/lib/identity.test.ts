import { describe, expect, it } from "vitest";
import {
  identitySsoProviderLabels,
  identitySsoProviders,
  type IdentitySsoDraft,
  defaultIdentitySession,
} from "./identity";

describe("identity SSO options", () => {
  it("supports common user providers for social login", () => {
    const socialProviders: Array<IdentitySsoDraft["provider"]> = ["apple", "google", "microsoft"];
    expect(identitySsoProviders).toEqual(expect.arrayContaining(socialProviders));
  });

  it("provides readable labels for configured providers", () => {
    expect(identitySsoProviderLabels.apple).toBe("Apple");
    expect(identitySsoProviderLabels.google).toBe("Google");
    expect(identitySsoProviderLabels.microsoft).toBe("Microsoft");
  });

  it("keeps session provider fields typed and optional", () => {
    const session = defaultIdentitySession();
    expect(session.authenticated).toBe(false);
    expect(session.ssoProvider).toBe("none");
    expect(session.isDeveloper).toBe(false);
  });
});
