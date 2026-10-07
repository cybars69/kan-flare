// End-to-end smoke test against a running Worker: sign up, then drive the
// core board flow through the real tRPC API.
const B = process.argv[2] ?? "http://localhost:8787";
let cookie = "";
const email = `smoke-${Date.now()}@example.com`;
async function call(path, { method = "GET", body } = {}) {
  const res = await fetch(B + path, {
    method,
    headers: { "content-type": "application/json", origin: B, cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text.slice(0, 200); }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  return json;
}
const mutate = (p, input) => call(`/api/trpc/${p}`, { method: "POST", body: { json: input } }).then((r) => r.result.data.json);
const query = (p, input) => call(`/api/trpc/${p}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`).then((r) => r.result.data.json);

await call("/api/auth/sign-up/email", { method: "POST", body: { email, password: "correct-horse-battery", name: "Smoke" } });
const ws = await mutate("workspace.create", { name: "Smoke WS" });
console.log("workspace", ws.publicId, ws.slug ?? "");
const board = await mutate("board.create", { name: "Smoke Board", workspacePublicId: ws.publicId, lists: ["Todo", "Done"], labels: ["Bug"] });
console.log("board", board.publicId);
let b = await query("board.byId", { boardPublicId: board.publicId });
const [todo, done] = b.lists;
for (const t of ["one", "two", "three"]) {
  await mutate("card.create", { title: t, description: "", listPublicId: todo.publicId, labelPublicIds: [], memberPublicIds: [], position: "end" });
}
b = await query("board.byId", { boardPublicId: board.publicId });
const two = b.lists[0].cards.find((c) => c.title === "two");
await mutate("card.update", { cardPublicId: two.publicId, listPublicId: done.publicId, index: 0 });
await mutate("card.create", { title: "zero", description: "", listPublicId: todo.publicId, labelPublicIds: [], memberPublicIds: [], position: "start" });
b = await query("board.byId", { boardPublicId: board.publicId });
const view = b.lists.map((l) => `${l.name}: ${l.cards.map((c) => `${c.title}@${c.index}`).join(", ")}`);
console.log(view.join(" | "));
const search = await query("workspace.search", { workspacePublicId: ws.publicId, query: "thr" }).catch((e) => String(e).slice(0, 200));
console.log("search", JSON.stringify(search).slice(0, 200));
const expected = "Todo: zero@0, one@1, three@2 | Done: two@0";
if (view.join(" | ") !== expected) { console.error("UNEXPECTED ORDER, wanted:", expected); process.exit(1); }

// Storage on R2 (Phase 6)
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) process.exitCode = 1;
};
const raw = (path, init = {}) =>
  fetch(B + path, { redirect: "manual", ...init, headers: { origin: B, cookie, ...(init.headers ?? {}) } });
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...Array(64).fill(7)]);

const avatarRes = await raw("/api/upload/avatar", {
  method: "POST",
  headers: { "content-type": "image/png", "x-original-filename": "me.png" },
  body: png,
});
const avatar = await avatarRes.json();
check("avatar upload", avatarRes.status === 200, JSON.stringify(avatar).slice(0, 80));
const avatarGet = await raw(`/api/files/avatars/${avatar.key}`);
const avatarBytes = new Uint8Array(await avatarGet.arrayBuffer());
check("avatar served publicly", avatarGet.status === 200 && avatarBytes.length === png.length && avatarGet.headers.get("content-type") === "image/png");

const target = b.lists[0].cards[0];
const pdf = new TextEncoder().encode("%PDF-1.4 smoke");
const upRes = await raw(`/api/upload/attachment?cardPublicId=${target.publicId}`, {
  method: "POST",
  headers: { "content-type": "application/pdf", "x-original-filename": encodeURIComponent("report 1.pdf") },
  body: pdf,
});
check("attachment upload", upRes.status === 200, String(upRes.status));
let card = await query("card.byId", { cardPublicId: target.publicId });
const att = card.attachments[0];
check("attachment has signed url", /\/api\/files\/attachments\/.+\?exp=\d+&sig=/.test(att?.url ?? ""), att?.url);
const signedPath = att.url.replace(B, "");
const signedGet = await raw(signedPath, { headers: { cookie: "" } });
check("signed url serves file without a session", signedGet.status === 200 && (await signedGet.text()) === "%PDF-1.4 smoke");
check("pdf served inline with sandbox CSP", signedGet.headers.get("content-disposition")?.startsWith("inline") && signedGet.headers.get("content-security-policy") === "sandbox");
const unsigned = await raw(signedPath.split("?")[0]);
check("unsigned attachment rejected", unsigned.status === 403, String(unsigned.status));
const tampered = await raw(signedPath.replace(/sig=([0-9a-f])/, (m, c) => `sig=${c === "0" ? "1" : "0"}`));
check("tampered signature rejected", tampered.status === 403, String(tampered.status));
const dl = await raw(`/api/download/attatchment?url=${encodeURIComponent(att.url)}&filename=${encodeURIComponent("report 1.pdf")}`);
const dlTarget = dl.headers.get("location") ?? "";
const dlGet = await raw(dlTarget);
check("download route forces attachment", dl.status === 302 && dlGet.status === 200 && dlGet.headers.get("content-disposition")?.startsWith("attachment"), dlGet.headers.get("content-disposition") ?? String(dl.status));

const { url: putUrl, key: putKey } = await mutate("attachment.generateUploadUrl", { cardPublicId: target.publicId, filename: "api.txt", contentType: "text/plain", size: 5 });
const putRes = await raw(putUrl.replace(B, ""), { method: "PUT", headers: { "content-type": "text/plain" }, body: "hello" });
check("signed PUT upload", putRes.status === 200, String(putRes.status));
await mutate("attachment.confirm", { cardPublicId: target.publicId, s3Key: putKey, filename: "api.txt", originalFilename: "api.txt", contentType: "text/plain", size: 5 });
card = await query("card.byId", { cardPublicId: target.publicId });
const txt = card.attachments.find((a) => a.originalFilename === "api.txt");
const txtGet = await raw(txt.url.replace(B, ""));
check("non-inline type forced to download", txtGet.status === 200 && txtGet.headers.get("content-disposition")?.startsWith("attachment") && (await txtGet.text()) === "hello");

await mutate("attachment.delete", { attachmentPublicId: att.publicId });
const afterDelete = await raw(signedPath);
check("deleted attachment gone from R2", afterDelete.status === 404, String(afterDelete.status));

const health = await query("health.health").catch((e) => ({ error: String(e).slice(0, 120) }));
check("health reports storage ok", health.storage === "ok" && health.database === "ok", JSON.stringify(health).slice(0, 120));

if (process.exitCode) process.exit(process.exitCode);
console.log("SMOKE OK");
