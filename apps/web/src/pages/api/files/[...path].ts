import { Readable } from "node:stream";
import type { NextApiRequest, NextApiResponse } from "next";

import type { StorageKind } from "@kan/shared/storage";
import { withApiLogging } from "@kan/api/utils/apiLogging";
import { withRateLimit } from "@kan/api/utils/rateLimit";
import { getObject, putObject, verifyFileSignature } from "@kan/shared/storage";

/**
 * Serves files from R2, replacing direct S3 URLs.
 *
 * GET  /api/files/avatars/<key>                      public, like the old
 *                                                    public-read avatar bucket
 * GET  /api/files/attachments/<key>?exp=&sig=        signed, expiring
 * PUT  /api/files/attachments/<key>?exp=&sig=&method=PUT
 *                                                    signed upload for API
 *                                                    clients (attachment.generateUploadUrl)
 *
 * Add `download=<filename>` to a GET to force a download.
 */

export const config = { api: { bodyParser: false } };

const KINDS: StorageKind[] = ["avatars", "attachments"];
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // matches attachment.generateUploadUrl
// Types a browser may render inline. Everything else is forced to download,
// since files are served from the app's own origin.
const INLINE_TYPES =
  /^(image\/(png|jpe?g|gif|webp|avif)|video\/|audio\/|application\/pdf$)/;

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const contentDisposition = (
  type: "inline" | "attachment",
  filename: string,
) => {
  const encoded = encodeURIComponent(filename);
  return `${type}; filename="${encoded}"; filename*=UTF-8''${encoded}`;
};

export default withRateLimit(
  { points: 300, duration: 60 },
  withApiLogging(async (req: NextApiRequest, res: NextApiResponse) => {
    const segments = req.query.path;
    if (!Array.isArray(segments) || segments.length < 2) {
      return res.status(404).json({ error: "Not found" });
    }
    const [kindSegment, ...keySegments] = segments;
    const kind = KINDS.find((k) => k === kindSegment);
    const key = keySegments.join("/");
    if (!kind || !key || keySegments.some((s) => s === ".." || s === ".")) {
      return res.status(404).json({ error: "Not found" });
    }

    const exp = first(req.query.exp);
    const sig = first(req.query.sig);

    if (req.method === "PUT") {
      const allowed =
        kind === "attachments" &&
        first(req.query.method) === "PUT" &&
        (await verifyFileSignature(kind, key, { exp, sig, method: "PUT" }));
      if (!allowed) return res.status(403).json({ error: "Invalid signature" });

      const contentType = req.headers["content-type"];
      const contentLength = Number.parseInt(
        req.headers["content-length"] ?? "",
        10,
      );
      if (!contentType) {
        return res.status(400).json({ error: "Missing content type" });
      }
      if (!Number.isFinite(contentLength) || contentLength <= 0) {
        return res
          .status(400)
          .json({ error: "Missing or invalid content length" });
      }
      if (contentLength > MAX_UPLOAD_BYTES) {
        return res.status(400).json({ error: "File too large" });
      }

      await putObject(kind, key, Readable.toWeb(req) as ReadableStream, {
        contentType,
        contentLength,
      });
      return res.status(200).json({ key });
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD, PUT");
      return res.status(405).json({ error: "Method not allowed" });
    }

    if (
      kind === "attachments" &&
      !(await verifyFileSignature(kind, key, { exp, sig, method: "GET" }))
    ) {
      return res.status(403).json({ error: "Invalid or expired link" });
    }

    const object = await getObject(kind, key);
    if (!object) return res.status(404).json({ error: "Not found" });

    const contentType =
      object.httpMetadata?.contentType ?? "application/octet-stream";
    const download = first(req.query.download);
    const filename = download ?? key.split("/").pop() ?? "file";
    const inline = !download && INLINE_TYPES.test(contentType);

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", String(object.size));
    res.setHeader("ETag", object.httpEtag);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "sandbox");
    res.setHeader(
      "Content-Disposition",
      contentDisposition(inline ? "inline" : "attachment", filename),
    );
    res.setHeader(
      "Cache-Control",
      kind === "avatars" ? "public, max-age=86400" : "private, max-age=3600",
    );

    if (req.headers["if-none-match"] === object.httpEtag) {
      await object.body.cancel();
      return res.status(304).end();
    }
    if (req.method === "HEAD") {
      await object.body.cancel();
      return res.status(200).end();
    }

    res.status(200);
    Readable.fromWeb(
      object.body as Parameters<typeof Readable.fromWeb>[0],
    ).pipe(res);
  }),
);
