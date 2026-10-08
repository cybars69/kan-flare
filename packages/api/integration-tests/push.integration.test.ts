import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as pushSubscriptionRepo from "@kan/db/repository/pushSubscription.repo";
import * as schema from "@kan/db/schema";

import type { PushNotificationData } from "../src/utils/push";
import { isAllowedPushEndpoint, sendPushToUser } from "../src/utils/push";
import { createTestDb, seedTestData } from "./test-db";

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  Buffer.from(
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
  ).toString("base64url");
const fromB64url = (value: string) =>
  new Uint8Array(Buffer.from(value, "base64url"));
const utf8 = (value: string) => new TextEncoder().encode(value);
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

/** A browser's side of a subscription: its ECDH key pair and auth secret. */
async function createDevice(endpoint: string) {
  const keys = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const publicKey = new Uint8Array(
    await crypto.subtle.exportKey("raw", keys.publicKey),
  );
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    endpoint,
    privateKey: keys.privateKey,
    publicKey,
    auth,
    p256dh: b64url(publicKey),
    authB64: b64url(auth),
  };
}

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, [
    "deriveBits",
  ]);
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt, info },
      key,
      length * 8,
    ),
  );
}

/** Decrypts an aes128gcm Web Push body as a browser would (RFC 8291). */
async function decryptPush(
  device: Awaited<ReturnType<typeof createDevice>>,
  body: Uint8Array,
) {
  const salt = body.slice(0, 16);
  const idLength = body[20]!;
  const serverPublic = body.slice(21, 21 + idLength);
  const ciphertext = body.slice(21 + idLength);

  const serverKey = await crypto.subtle.importKey(
    "raw",
    serverPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: serverKey },
      device.privateKey,
      256,
    ),
  );
  const ikm = await hkdf(
    device.auth,
    ecdhSecret,
    concat(utf8("WebPush: info\0"), device.publicKey, serverPublic),
    32,
  );
  const cek = await hkdf(salt, ikm, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, utf8("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, [
    "decrypt",
  ]);
  const padded = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce },
      aes,
      ciphertext,
    ),
  );
  // The last record ends with a 0x02 delimiter followed by zero padding.
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  expect(padded[end]).toBe(2);
  return JSON.parse(
    new TextDecoder().decode(padded.slice(0, end)),
  ) as PushNotificationData;
}

async function verifyVapid(authorization: string, vapidPublicKey: string) {
  const match = /^vapid t=([^,]+), k=(.+)$/.exec(authorization);
  expect(match).not.toBeNull();
  const [, jwt, key] = match!;
  expect(key).toBe(vapidPublicKey);
  const [header, claims, signature] = jwt!.split(".");
  const publicKey = await crypto.subtle.importKey(
    "raw",
    fromB64url(vapidPublicKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    fromB64url(signature!),
    utf8(`${header}.${claims}`),
  );
  expect(valid).toBe(true);
  return JSON.parse(Buffer.from(claims!, "base64url").toString()) as {
    aud: string;
    sub: string;
    exp: number;
  };
}

describe("web push on D1", () => {
  let vapidPublicKey: string;
  const sent: { url: string; init: RequestInit }[] = [];
  let statusFor: (url: string) => number;

  beforeEach(async () => {
    const vapid = (await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign"],
    )) as CryptoKeyPair;
    vapidPublicKey = b64url(
      await crypto.subtle.exportKey("raw", vapid.publicKey),
    );
    const jwk = await crypto.subtle.exportKey("jwk", vapid.privateKey);
    vi.stubEnv("VAPID_PUBLIC_KEY", vapidPublicKey);
    vi.stubEnv("VAPID_PRIVATE_KEY", jwk.d!);
    vi.stubEnv("VAPID_SUBJECT", "");
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://tasks.example.com");

    sent.length = 0;
    statusFor = () => 201;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init: RequestInit) => {
        sent.push({ url, init });
        return Promise.resolve(new Response(null, { status: statusFor(url) }));
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends an encrypted push each subscribed device can decrypt", async () => {
    const db = await createTestDb();
    const { user } = await seedTestData(db);
    const phone = await createDevice("https://web.push.apple.com/QGuQyavXut");
    const laptop = await createDevice(
      "https://fcm.googleapis.com/fcm/send/abc:def",
    );
    for (const device of [phone, laptop]) {
      await pushSubscriptionRepo.upsert(db, {
        userId: user.id,
        endpoint: device.endpoint,
        p256dh: device.p256dh,
        auth: device.authB64,
      });
    }

    const result = await sendPushToUser(db, user.id, {
      title: "Ada mentioned you",
      body: "Launch · Roadmap",
      url: "/cards/abcdefghijkl",
      tag: "mention-abcdefghijkl",
    });
    expect(result).toEqual({ sent: 2, removed: 0 });
    expect(sent.map((s) => s.url).sort()).toEqual(
      [phone.endpoint, laptop.endpoint].sort(),
    );

    for (const device of [phone, laptop]) {
      const request = sent.find((s) => s.url === device.endpoint)!;
      const headers = request.init.headers as Record<string, string>;
      expect(headers["content-encoding"]).toBe("aes128gcm");
      expect(headers.urgency).toBe("high");
      expect(headers.ttl).toBe("86400");

      const claims = await verifyVapid(headers.authorization!, vapidPublicKey);
      expect(claims.aud).toBe(new URL(device.endpoint).origin);
      expect(claims.sub).toBe("https://tasks.example.com");

      const data = await decryptPush(
        device,
        new Uint8Array(request.init.body as ArrayBuffer),
      );
      expect(data).toEqual({
        title: "Ada mentioned you",
        body: "Launch · Roadmap",
        url: "/cards/abcdefghijkl",
        tag: "mention-abcdefghijkl",
        badgeCount: 0,
      });
    }
  });

  it("deletes subscriptions the push service reports as gone", async () => {
    const db = await createTestDb();
    const { user } = await seedTestData(db);
    const gone = await createDevice("https://fcm.googleapis.com/fcm/send/gone");
    const live = await createDevice("https://fcm.googleapis.com/fcm/send/live");
    for (const device of [gone, live]) {
      await pushSubscriptionRepo.upsert(db, {
        userId: user.id,
        endpoint: device.endpoint,
        p256dh: device.p256dh,
        auth: device.authB64,
      });
    }
    statusFor = (url) => (url === gone.endpoint ? 410 : 201);

    const result = await sendPushToUser(db, user.id, {
      title: "t",
      body: "b",
      url: "/",
    });
    expect(result).toEqual({ sent: 1, removed: 1 });
    const left = await pushSubscriptionRepo.getAllForUser(db, user.id);
    expect(left.map((s) => s.endpoint)).toEqual([live.endpoint]);
  });

  it("moves a device's subscription to whoever subscribed last", async () => {
    const db = await createTestDb();
    const { user } = await seedTestData(db);
    const [other] = await db
      .insert(schema.users)
      .values({
        id: crypto.randomUUID(),
        name: "Other",
        email: "other@example.com",
        emailVerified: true,
      })
      .returning();
    const device = await createDevice("https://fcm.googleapis.com/fcm/send/x");
    const subscription = {
      endpoint: device.endpoint,
      p256dh: device.p256dh,
      auth: device.authB64,
    };

    await pushSubscriptionRepo.upsert(db, { userId: user.id, ...subscription });
    await pushSubscriptionRepo.upsert(db, {
      userId: other!.id,
      ...subscription,
    });

    expect(await pushSubscriptionRepo.getAllForUser(db, user.id)).toHaveLength(
      0,
    );
    expect(
      await pushSubscriptionRepo.getAllForUser(db, other!.id),
    ).toHaveLength(1);
    // Only the owner can remove it.
    expect(
      await pushSubscriptionRepo.deleteForUser(db, {
        userId: user.id,
        endpoint: device.endpoint,
      }),
    ).toBe(0);
    expect(
      await pushSubscriptionRepo.deleteForUser(db, {
        userId: other!.id,
        endpoint: device.endpoint,
      }),
    ).toBe(1);
  });

  it("does nothing without VAPID keys", async () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    const db = await createTestDb();
    const { user } = await seedTestData(db);
    const device = await createDevice("https://fcm.googleapis.com/fcm/send/y");
    await pushSubscriptionRepo.upsert(db, {
      userId: user.id,
      endpoint: device.endpoint,
      p256dh: device.p256dh,
      auth: device.authB64,
    });
    expect(
      await sendPushToUser(db, user.id, { title: "t", body: "b", url: "/" }),
    ).toEqual({ sent: 0, removed: 0 });
    expect(sent).toHaveLength(0);
    const rows = await db
      .select()
      .from(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.userId, user.id));
    expect(rows).toHaveLength(1);
  });

  it("only accepts endpoints of real push services", () => {
    for (const ok of [
      "https://fcm.googleapis.com/fcm/send/a",
      "https://web.push.apple.com/a",
      "https://updates.push.services.mozilla.com/wpush/v2/a",
      "https://wns2-par02p.notify.windows.com/w/?token=a",
    ]) {
      expect(isAllowedPushEndpoint(ok)).toBe(true);
    }
    for (const bad of [
      "http://fcm.googleapis.com/fcm/send/a",
      "https://evil.example.com/push",
      "https://fcm.googleapis.com.evil.com/a",
      "https://apple.com.attacker.net/x.push.apple.com",
      "https://localhost/push",
      "not a url",
    ]) {
      expect(isAllowedPushEndpoint(bad)).toBe(false);
    }
  });
});
