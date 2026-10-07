import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * File storage on Cloudflare R2 through Worker bindings.
 *
 * - `avatars` (binding AVATARS): served publicly at /api/files/avatars/<key>,
 *   as the S3 avatar bucket was public-read.
 * - `attachments` (binding ATTACHMENTS): served at /api/files/attachments/<key>
 *   only with a signed, expiring query string, replacing S3 presigned URLs.
 */
export type StorageKind = "avatars" | "attachments" | "imageVariants";

const BINDINGS: Record<StorageKind, string> = {
  avatars: "AVATARS",
  attachments: "ATTACHMENTS",
  // Resized/converted copies made by /api/image (see Phase 10).
  imageVariants: "IMAGE_VARIANTS",
};

/** The subset of the R2 bucket binding this module uses. */
export interface StorageObject {
  body: ReadableStream;
  size: number;
  httpEtag: string;
  httpMetadata?: { contentType?: string };
}

interface StorageBucket {
  list(options: {
    prefix: string;
    cursor?: string;
  }): Promise<{
    objects: { key: string }[];
    truncated: boolean;
    cursor?: string;
  }>;
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | Uint8Array,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<StorageObject | null>;
  head(key: string): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
}

export const getBucket = (kind: StorageKind): StorageBucket => {
  const { env } = getCloudflareContext() as unknown as {
    env: Record<string, StorageBucket | undefined>;
  };
  const bucket = env[BINDINGS[kind]];
  if (!bucket) {
    throw new Error(
      `No R2 binding named ${BINDINGS[kind]}. Check r2_buckets in apps/web/wrangler.jsonc.`,
    );
  }
  return bucket;
};

/** True when the R2 binding for `kind` is configured. */
export const isStorageConfigured = (kind: StorageKind) => {
  try {
    getBucket(kind);
    return true;
  } catch {
    return false;
  }
};

declare const FixedLengthStream:
  | (new (length: number) => {
      readable: ReadableStream;
      writable: WritableStream;
    })
  | undefined;

/**
 * Stores an object. R2 needs the length of a streamed body up front, so a
 * stream is piped through the Workers runtime's FixedLengthStream; where that
 * does not exist (`next dev` on Node) the body is buffered instead.
 */
export async function putObject(
  kind: StorageKind,
  key: string,
  body: ReadableStream | ArrayBuffer | Uint8Array,
  options: { contentType: string; contentLength?: number },
) {
  const bucket = getBucket(kind);
  const httpMetadata = { contentType: options.contentType };

  if (body instanceof ReadableStream) {
    if (
      typeof FixedLengthStream !== "undefined" &&
      options.contentLength !== undefined
    ) {
      const { readable, writable } = new FixedLengthStream(
        options.contentLength,
      );
      const [, result] = await Promise.all([
        body.pipeTo(writable),
        bucket.put(key, readable, { httpMetadata }),
      ]);
      return result;
    }
    const buffered = await new Response(body).arrayBuffer();
    return bucket.put(key, buffered, { httpMetadata });
  }

  return bucket.put(key, body, { httpMetadata });
}

export const getObject = (kind: StorageKind, key: string) =>
  getBucket(kind).get(key);

export async function deleteObject(kind: StorageKind, key: string) {
  await getBucket(kind).delete(key);
}

const encoder = new TextEncoder();

const signingKey = () => {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is required to sign URLs");
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(`kan-flare-files:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
};

const toHex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const fromHex = (hex: string) =>
  new Uint8Array((hex.match(/../g) ?? []).map((b) => parseInt(b, 16)));

type SignedMethod = "GET" | "PUT";

const signedPayload = (
  method: SignedMethod,
  kind: StorageKind,
  key: string,
  expires: number,
) => encoder.encode(`${method}\n${kind}\n${key}\n${expires}`);

/** `/api/files/<kind>/<key>`, with each key segment URL-encoded. */
export const filePath = (kind: StorageKind, key: string) =>
  `/api/files/${kind}/${key.split("/").map(encodeURIComponent).join("/")}`;

const absolute = (path: string) => {
  const base = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "");
  return base ? `${base}${path}` : path;
};

/** A URL that allows `method` on one object until it expires. */
export async function signFileUrl(
  kind: StorageKind,
  key: string,
  { expiresIn = 3600, method = "GET" as SignedMethod } = {},
) {
  const expires = Math.floor(Date.now() / 1000) + expiresIn;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(),
    signedPayload(method, kind, key, expires),
  );
  const params = new URLSearchParams({
    exp: String(expires),
    sig: toHex(signature),
  });
  if (method !== "GET") params.set("method", method);
  return absolute(`${filePath(kind, key)}?${params.toString()}`);
}

export async function verifyFileSignature(
  kind: StorageKind,
  key: string,
  { exp, sig, method }: { exp?: string; sig?: string; method: SignedMethod },
) {
  const expires = Number(exp);
  if (!sig || !Number.isInteger(expires)) return false;
  if (expires < Math.floor(Date.now() / 1000)) return false;
  return crypto.subtle.verify(
    "HMAC",
    await signingKey(),
    fromHex(sig),
    signedPayload(method, kind, key, expires),
  );
}

/** A URL that lets an API client upload one attachment with PUT. */
export const generateUploadUrl = (key: string, expiresIn = 3600) =>
  signFileUrl("attachments", key, { expiresIn, method: "PUT" });

/**
 * Avatar URL for an image key. Full URLs (external providers) are returned
 * as-is; keys map to the public avatar route.
 */
export function generateAvatarUrl(
  imageKey: string | null | undefined,
): Promise<string | null> {
  if (!imageKey) return Promise.resolve(null);
  if (imageKey.startsWith("http://") || imageKey.startsWith("https://")) {
    return Promise.resolve(imageKey);
  }
  return Promise.resolve(absolute(filePath("avatars", imageKey)));
}

/** A signed, expiring URL for an attachment, or null if signing fails. */
export async function generateAttachmentUrl(
  attachmentKey: string | null | undefined,
  expiresIn = 86400, // 24 hours
): Promise<string | null> {
  if (!attachmentKey) return null;
  try {
    return await signFileUrl("attachments", attachmentKey, { expiresIn });
  } catch {
    return null;
  }
}

const sha256Hex = async (value: string) =>
  toHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));

/**
 * R2 prefix for all image variants of one stored object. Variants live
 * under it so they can be removed together when the source changes.
 */
export const imageVariantPrefix = async (kind: StorageKind, key: string) =>
  `${kind}/${await sha256Hex(`${kind}:${key}`)}/`;

/** Removes every resized/converted copy of a stored image. */
export async function deleteImageVariants(kind: StorageKind, key: string) {
  if (!isStorageConfigured("imageVariants")) return;
  const bucket = getBucket("imageVariants");
  const prefix = await imageVariantPrefix(kind, key);
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor });
    if (page.objects.length) {
      await bucket.delete(page.objects.map((object) => object.key));
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
