import type { ImageLoaderProps } from "next/image";

/**
 * next/image loader: every image goes through /api/image, which resizes and
 * converts it once with Cloudflare Images and keeps the result in R2.
 *
 * The source travels base64url-encoded: signed attachment URLs carry their
 * own query string, and on Workers an encoded `&` inside a query parameter
 * arrives decoded, which would split the signature off.
 */
export const encodeImageSource = (src: string) =>
  btoa(
    Array.from(new TextEncoder().encode(src), (byte) =>
      String.fromCharCode(byte),
    ).join(""),
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export const decodeImageSource = (encoded: string) => {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return new TextDecoder().decode(
    Uint8Array.from(binary, (char) => char.charCodeAt(0)),
  );
};

export default function imageLoader({ src, width, quality }: ImageLoaderProps) {
  const params = new URLSearchParams({
    s: encodeImageSource(src),
    w: String(width),
    q: String(quality ?? 75),
  });
  return `/api/image?${params.toString()}`;
}
