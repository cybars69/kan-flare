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
  ])("refuses %s", async (url) => {
    await expect(fetchClientMetadataResource(url)).rejects.toThrow(TypeError);
  });

  it("fetches public HTTPS metadata documents", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}"));
    const url = "https://claude.ai/oauth/mcp-oauth-client-metadata";
    await fetchClientMetadataResource(url, {
      redirect: "error",
      headers: { accept: "application/json" },
    });
    // Workers' fetch rejects redirect: "error", so it's sent as "manual".
    expect(fetchMock).toHaveBeenCalledWith(new URL(url), {
      redirect: "manual",
      headers: { accept: "application/json" },
    });
    fetchMock.mockRestore();
  });

  it("refuses a metadata document that redirects", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://elsewhere.example/" },
      }),
    );
    await expect(
      fetchClientMetadataResource("https://claude.ai/oauth/metadata", {
        redirect: "error",
      }),
    ).rejects.toThrow("must not redirect");
    fetchMock.mockRestore();
  });
});

describe("isOAuthAccessToken", () => {
  it("tells OAuth access tokens apart from API keys", () => {
    expect(isOAuthAccessToken("kan_oat_abc")).toBe(true);
    expect(isOAuthAccessToken("kan_abc")).toBe(false);
  });
});
