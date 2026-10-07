import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAvatarUrl, isPlaceholderPublicId } from "./helpers";

describe("isPlaceholderPublicId", () => {
  it("identifies optimistic entity IDs", () => {
    expect(isPlaceholderPublicId("PLACEHOLDER_abc123")).toBe(true);
    expect(isPlaceholderPublicId("abc123")).toBe(false);
  });
});

describe("getAvatarUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty string for null input", () => {
    expect(getAvatarUrl(null)).toBe("");
  });

  it("returns empty string for empty string input", () => {
    expect(getAvatarUrl("")).toBe("");
  });

  it("returns URL unchanged if already absolute http", () => {
    expect(getAvatarUrl("http://example.com/avatar.jpg")).toBe(
      "http://example.com/avatar.jpg",
    );
  });

  it("returns URL unchanged if already absolute https", () => {
    expect(getAvatarUrl("https://example.com/avatar.jpg")).toBe(
      "https://example.com/avatar.jpg",
    );
  });

  it("maps a stored key to the R2 avatar route", () => {
    expect(getAvatarUrl("user123/avatar.jpg")).toBe(
      "/api/files/avatars/user123/avatar.jpg",
    );
  });

  it("encodes each key segment", () => {
    expect(getAvatarUrl("user 1/my avatar.png")).toBe(
      "/api/files/avatars/user%201/my%20avatar.png",
    );
  });
});
