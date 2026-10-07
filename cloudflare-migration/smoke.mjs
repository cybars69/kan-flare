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
console.log("SMOKE OK");
