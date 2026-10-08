import { describe, expect, it } from "vitest";

import { isOAuthSignIn, oauthResumeUrl } from "./oauthFlow";

const signed =
  "?response_type=code&client_id=abc&redirect_uri=https%3A%2F%2Fapp.example%2Fcb&scope=openid&state=s1&code_challenge=x&code_challenge_method=S256&exp=1&ba_iat=2&ba_param=client_id&ba_param=sig&sig=zzz";

describe("OAuth sign-in on the login page", () => {
  it("is detected only with a signed request", () => {
    expect(isOAuthSignIn(signed)).toBe(true);
    expect(isOAuthSignIn("?next=/boards")).toBe(false);
    expect(isOAuthSignIn("?client_id=abc")).toBe(false);
  });

  it("resumes the original authorization request", () => {
    const url = new URL(oauthResumeUrl(signed), "https://kan.example");
    expect(url.pathname).toBe("/api/auth/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe("abc");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example/cb");
    expect(url.searchParams.get("code_challenge")).toBe("x");
    for (const name of ["sig", "exp", "ba_iat", "ba_param"]) {
      expect(url.searchParams.has(name)).toBe(false);
    }
  });

  it("drops a satisfied prompt=login", () => {
    const url = new URL(
      oauthResumeUrl(`${signed}&prompt=login`),
      "https://kan.example",
    );
    expect(url.searchParams.has("prompt")).toBe(false);
  });
});
