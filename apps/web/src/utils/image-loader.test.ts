import { describe, expect, it } from "vitest";

import imageLoader, {
  decodeImageSource,
  encodeImageSource,
} from "./image-loader";

describe("image loader", () => {
  it("round-trips sources with query strings and non-ASCII characters", () => {
    for (const src of [
      "/api/files/attachments/w/c/a.png?exp=1&sig=ab+/=",
      "https://example.com/avatar.jpg",
      "/hero-light.png",
      "/api/files/avatars/u/ünïcode file.png",
    ]) {
      const encoded = encodeImageSource(src);
      expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeImageSource(encoded)).toBe(src);
    }
  });

  it("builds an /api/image URL with width and default quality", () => {
    const url = new URL(
      imageLoader({ src: "/hero-light.png", width: 640 }),
      "http://localhost",
    );
    expect(url.pathname).toBe("/api/image");
    expect(url.searchParams.get("w")).toBe("640");
    expect(url.searchParams.get("q")).toBe("75");
    expect(decodeImageSource(url.searchParams.get("s") ?? "")).toBe(
      "/hero-light.png",
    );
  });
});
