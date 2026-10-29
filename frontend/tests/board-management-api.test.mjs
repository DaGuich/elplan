import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundled = buildSync({
  entryPoints: [new URL("../src/features/projects/components/board-management-api.ts", import.meta.url).pathname],
  bundle: true,
  format: "esm",
  write: false,
  logLevel: "silent",
}).outputFiles[0].text;
const { boardManagementApi } = await import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);
globalThis.localStorage = { getItem: () => null };

test("board reads capture revisions and mutations supply If-Match", async () => {
  const oldFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (path, init) => {
    calls.push({ path, init });
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return new Response(init?.method ? "{}" : "[]", { headers: { "X-Topology-Revision": "7" } });
  };
  try {
    const snapshot = await boardManagementApi.list(1);
    assert.equal(snapshot.revision, "7");
    const input = { name: "Board", kind: "sub", floor_id: null, data: {} };
    await boardManagementApi.create(1, input, snapshot.revision);
    await boardManagementApi.update(1, 2, input, snapshot.revision);
    await boardManagementApi.delete(1, 2, snapshot.revision);
    for (const call of calls.slice(1)) assert.equal(call.init.headers["If-Match"], "7");
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("board editing is blocked if the server omits its revision", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("[]");
  try {
    await assert.rejects(boardManagementApi.list(1), /Missing topology revision/);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
