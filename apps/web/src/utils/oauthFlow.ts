/*
 * When an app (an MCP client such as Claude) sends someone to sign in through
 * kan-flare's OAuth server, the login page URL carries the signed
 * authorization request (`sig`, `exp`, `ba_*` plus the original parameters).
 */

const SIGNATURE_PARAMS = ["sig", "exp", "ba_iat", "ba_param", "ba_pl"];

/** True while the login page is part of an OAuth sign-in. */
export function isOAuthSignIn(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.has("sig") && params.has("client_id");
}

/**
 * The authorization request to resume once the person is signed in (after a
 * magic link or a social sign-in, which leave the page).
 */
export function oauthResumeUrl(search: string): string {
  const params = new URLSearchParams(search);
  for (const name of SIGNATURE_PARAMS) params.delete(name);
  // Signing in just happened, so a prompt=login request is satisfied.
  if (params.get("prompt") === "login") params.delete("prompt");
  return `/api/auth/oauth2/authorize?${params.toString()}`;
}
