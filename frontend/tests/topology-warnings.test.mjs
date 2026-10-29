import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundled = buildSync({
  entryPoints: [new URL("../src/features/projects/api.ts", import.meta.url).pathname],
  bundle: true,
  format: "esm",
  write: false,
  logLevel: "silent",
}).outputFiles[0].text;
const { projectsApi } = await import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);

globalThis.localStorage = { getItem: () => null };

test("floor-plan reads and saves expose topology warnings", async () => {
  const oldFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (path, init) => {
    calls.push({ path, init });
    return new Response(JSON.stringify({ rooms: [] }), {
      headers: { "X-Topology-Warnings": JSON.stringify(["Verteiler: incomplete data"]) },
    });
  };
  try {
    assert.deepEqual((await projectsApi.floorPlan(1, 2)).topology_warnings, ["Verteiler: incomplete data"]);
    assert.deepEqual((await projectsApi.saveFloorPlan(1, 2, { rooms: [] })).topology_warnings, ["Verteiler: incomplete data"]);
    assert.equal(calls[1].init.method, "PUT");
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("malformed topology warnings are surfaced instead of silently hidden", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { headers: { "X-Topology-Warnings": "{}" } });
  try {
    await assert.rejects(projectsApi.floorPlan(1, 2), /Invalid topology warning response/);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
