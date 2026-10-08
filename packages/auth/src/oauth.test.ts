import { describe, expect, it, vi } from "vitest";

import { fetchClientMetadataResource, isOAuthAccessToken } from "./oauth";

describe("fetchClientMetadataResource", () => {
  it.each([
    "http://claude.ai/oauth/mcp-oauth-client-metadata",
    "https://localhost/metadata.json",
    "https://app.localhost/metadata.json",
    "https://metadata.internal/client.json",
    "https://127.0.0.1/client.json",
    "https://[::1]/client.json",
  ])("refuses %s", (url) => {
    expect(() => fetchClientMetadataResource(url)).toThrow(TypeError);
  });

  it("fetches public HTTPS metadata documents", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}"));
    const url = "https://claude.ai/oauth/mcp-oauth-client-metadata";
    await fetchClientMetadataResource(url);
    expect(fetchMock).toHaveBeenCalledWith(new URL(url), undefined);
    fetchMock.mockRestore();
  });
});

describe("isOAuthAccessToken", () => {
  it("tells OAuth access tokens apart from API keys", () => {
    expect(isOAuthAccessToken("kan_oat_abc")).toBe(true);
    expect(isOAuthAccessToken("kan_abc")).toBe(false);
  });
});
