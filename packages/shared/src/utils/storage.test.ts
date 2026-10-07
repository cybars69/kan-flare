import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  filePath,
  generateAttachmentUrl,
  generateAvatarUrl,
  signFileUrl,
  verifyFileSignature,
} from "./storage";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(() => ({ env: {} })),
}));

const params = (url: string) => {
  const search = new URL(url, "http://localhost").searchParams;
  return {
    exp: search.get("exp") ?? undefined,
    sig: search.get("sig") ?? undefined,
  };
};

describe("storage URLs", () => {
  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = "test-secret";
    process.env.NEXT_PUBLIC_BASE_URL = "https://kan.example.com/";
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("encodes key segments in file paths", () => {
    expect(filePath("avatars", "user 1/a b.png")).toBe(
      "/api/files/avatars/user%201/a%20b.png",
    );
  });

  it("serves stored avatars from the public route and keeps external URLs", async () => {
    expect(await generateAvatarUrl("u1/avatar.png")).toBe(
      "https://kan.example.com/api/files/avatars/u1/avatar.png",
    );
    expect(await generateAvatarUrl("https://cdn.example.com/a.png")).toBe(
      "https://cdn.example.com/a.png",
    );
    expect(await generateAvatarUrl(null)).toBeNull();
  });

  it("verifies its own signature for the same object and method", async () => {
    const url = await generateAttachmentUrl("w/c/file.pdf");
    expect(url).toMatch(
      /^https:\/\/kan\.example\.com\/api\/files\/attachments\/w\/c\/file\.pdf\?exp=\d+&sig=[0-9a-f]{64}$/,
    );
    const { exp, sig } = params(url ?? "");
    await expect(
      verifyFileSignature("attachments", "w/c/file.pdf", {
        exp,
        sig,
        method: "GET",
      }),
    ).resolves.toBe(true);
  });

  it("rejects another key, another method, a tampered expiry or a missing signature", async () => {
    const { exp, sig } = params(
      await signFileUrl("attachments", "w/c/file.pdf"),
    );
    const verify = (
      key: string,
      method: "GET" | "PUT",
      overrides: { exp?: string; sig?: string } = {},
    ) =>
      verifyFileSignature("attachments", key, {
        exp,
        sig,
        method,
        ...overrides,
      });

    await expect(verify("w/c/other.pdf", "GET")).resolves.toBe(false);
    await expect(verify("w/c/file.pdf", "PUT")).resolves.toBe(false);
    await expect(
      verify("w/c/file.pdf", "GET", { exp: String(Number(exp) + 60) }),
    ).resolves.toBe(false);
    await expect(
      verify("w/c/file.pdf", "GET", { sig: undefined }),
    ).resolves.toBe(false);
  });

  it("rejects expired links", async () => {
    const { exp, sig } = params(
      await signFileUrl("attachments", "k", { expiresIn: 60 }),
    );
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61_000);
    await expect(
      verifyFileSignature("attachments", "k", { exp, sig, method: "GET" }),
    ).resolves.toBe(false);
  });

  it("rejects signatures made with a different secret", async () => {
    const { exp, sig } = params(await signFileUrl("attachments", "k"));
    process.env.BETTER_AUTH_SECRET = "rotated-secret";
    await expect(
      verifyFileSignature("attachments", "k", { exp, sig, method: "GET" }),
    ).resolves.toBe(false);
  });
});
