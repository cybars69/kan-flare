import { Readable } from "node:stream";
import type { NextApiRequest, NextApiResponse } from "next";
import { getCloudflareContext } from "@opennextjs/cloudflare";

import type { StorageKind } from "@kan/shared/storage";
import { withRateLimit } from "@kan/api/utils/rateLimit";
import {
  getBucket,
  getObject,
  imageVariantPrefix,
  isStorageConfigured,
  verifyFileSignature,
} from "@kan/shared/storage";

import { decodeImageSource } from "~/utils/image-loader";

/**
 * Image optimisation for next/image (see utils/image-loader.ts).
 *
 * GET /api/image?s=<base64url source>&w=<width>&q=<quality>
 *
 * Sources: stored avatars and signed attachments (/api/files/...), static
 * assets (/...) and external https images. Each variant is converted once
 * with the Cloudflare Images binding, kept in the IMAGE_VARIANTS bucket and
 * served from there afterwards. If conversion isn't available, the original
 * is served unchanged.
 */

const MAX_WIDTH = 3840;
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
// Formats that are passed through untouched (vector or animated).
const PASSTHROUGH = new Set(["image/svg+xml", "image/gif"]);

interface ImagesBinding {
  input(stream: ReadableStream): {
    transform(options: { width: number; fit: "scale-down" }): {
      output(options: { format: string; quality: number }): Promise<{
        response(): Response;
      }>;
    };
  };
}

interface Source {
  body: ReadableStream;
  contentType: string;
  /** Stable identity of the source bytes, used in the variant key. */
  version: string;
  /** Prefix that groups this source's variants, for deletion. */
  prefix: string;
  public: boolean;
}

type Env = {
  IMAGES?: ImagesBinding;
  ASSETS?: { fetch(request: Request): Promise<Response> };
};

const sha256Hex = async (value: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

async function resolveSource(
  src: string,
  origin: string,
  env: Env,
): Promise<Source | "forbidden" | null> {
  const url = new URL(src, origin);
  const sameOrigin =
    url.origin === origin ||
    url.origin === process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "");

  if (sameOrigin && url.pathname.startsWith("/api/files/")) {
    const [, , , kindSegment, ...keySegments] = url.pathname.split("/");
    const kind = (["avatars", "attachments"] as StorageKind[]).find(
      (k) => k === kindSegment,
    );
    const key = keySegments.map(decodeURIComponent).join("/");
    if (!kind || !key) return null;

    if (
      kind === "attachments" &&
      !(await verifyFileSignature(kind, key, {
        exp: url.searchParams.get("exp") ?? undefined,
        sig: url.searchParams.get("sig") ?? undefined,
        method: "GET",
      }))
    ) {
      return "forbidden";
    }

    const object = await getObject(kind, key);
    if (!object) return null;
    return {
      body: object.body,
      contentType: object.httpMetadata?.contentType ?? "",
      version: object.httpEtag,
      prefix: await imageVariantPrefix(kind, key),
      public: kind === "avatars",
    };
  }

  let response: Response;
  if (sameOrigin) {
    if (!env.ASSETS) return null;
    response = await env.ASSETS.fetch(new Request(url));
  } else if (url.protocol === "https:") {
    response = await fetch(url, { redirect: "follow" });
  } else {
    return "forbidden";
  }

  const contentType = response.headers.get("content-type") ?? "";
  const length = Number(response.headers.get("content-length") ?? 0);
  if (!response.ok || !response.body || !contentType.startsWith("image/")) {
    await response.body?.cancel();
    return null;
  }
  if (length > MAX_SOURCE_BYTES) {
    await response.body.cancel();
    return "forbidden";
  }

  const identity = sameOrigin ? url.pathname : url.href;
  return {
    body: response.body,
    contentType,
    version: response.headers.get("etag") ?? "",
    prefix: `external/${await sha256Hex(identity)}/`,
    public: true,
  };
}

const pickFormat = (accept: string | undefined, sourceType: string) => {
  if (accept?.includes("image/avif")) return "image/avif";
  if (accept?.includes("image/webp")) return "image/webp";
  return sourceType === "image/png" ? "image/png" : "image/jpeg";
};

const send = (
  res: NextApiResponse,
  body: ReadableStream,
  contentType: string,
  isPublic: boolean,
  cache: "hit" | "miss" | "bypass",
) => {
  res.setHeader("Content-Type", contentType);
  res.setHeader("X-Image-Cache", cache);
  res.setHeader("Vary", "Accept");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "sandbox");
  res.setHeader(
    "Cache-Control",
    isPublic ? "public, max-age=86400" : "private, max-age=3600",
  );
  res.status(200);
  Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
};

export default withRateLimit(
  { points: 600, duration: 60 },
  async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    let src: string;
    try {
      src = decodeImageSource(first(req.query.s) ?? "");
    } catch {
      return res.status(400).json({ error: "Invalid source" });
    }
    const width = Number.parseInt(first(req.query.w) ?? "", 10);
    const quality = Number.parseInt(first(req.query.q) ?? "75", 10);
    if (
      !src ||
      !(width > 0) ||
      width > MAX_WIDTH ||
      !(quality > 0) ||
      quality > 100
    ) {
      return res.status(400).json({ error: "Invalid parameters" });
    }

    const { env } = getCloudflareContext() as unknown as { env: Env };
    const proto = first(req.headers["x-forwarded-proto"]) ?? "http";
    const origin = `${proto}://${req.headers.host ?? "localhost"}`;

    const source = await resolveSource(src, origin, env);
    if (source === "forbidden") {
      return res.status(403).json({ error: "Image not allowed" });
    }
    if (!source) return res.status(404).json({ error: "Image not found" });

    if (PASSTHROUGH.has(source.contentType) || !env.IMAGES) {
      return send(
        res,
        source.body,
        source.contentType,
        source.public,
        "bypass",
      );
    }

    const format = pickFormat(first(req.headers.accept), source.contentType);
    const variantKey = `${source.prefix}${await sha256Hex(source.version)}-${width}-${quality}.${format.split("/")[1]}`;
    const variants = isStorageConfigured("imageVariants")
      ? getBucket("imageVariants")
      : undefined;

    const cached = await variants?.get(variantKey);
    if (cached) {
      await source.body.cancel();
      return send(res, cached.body, format, source.public, "hit");
    }

    const [forTransform, forFallback] = source.body.tee();
    try {
      const transformed = (
        await env.IMAGES.input(forTransform)
          .transform({ width, fit: "scale-down" })
          .output({ format, quality })
      ).response();
      const bytes = await transformed.arrayBuffer();
      await forFallback.cancel();
      await variants?.put(variantKey, bytes, {
        httpMetadata: { contentType: format },
      });
      return send(
        res,
        new Response(bytes).body as ReadableStream,
        format,
        source.public,
        "miss",
      );
    } catch {
      // Conversion failed (unsupported input, or the local simulator's
      // limits): serve the original rather than a broken image.
      return send(
        res,
        forFallback,
        source.contentType,
        source.public,
        "bypass",
      );
    }
  },
);
