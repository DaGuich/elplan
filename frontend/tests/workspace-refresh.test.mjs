import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundled = buildSync({
  entryPoints: [new URL("../src/features/projects/domain/workspace-refresh.ts", import.meta.url).pathname],
  bundle: true,
  format: "esm",
  write: false,
  logLevel: "silent",
}).outputFiles[0].text;
const { reconcileWorkspaceRefresh } = await import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);

test("refresh preserves a locally edited workspace but updates an unchanged one", () => {
  const old = { rooms: [] };
  const draft = { rooms: [{ id: "room" }] };
  const fresh = { rooms: [{ id: "remote" }] };
  const previous = { floorId: 1, data: old };
  assert.equal(reconcileWorkspaceRefresh(old, previous, 1, fresh), fresh);
  assert.equal(reconcileWorkspaceRefresh(draft, previous, 1, fresh), draft);
  assert.equal(reconcileWorkspaceRefresh(draft, previous, 2, fresh), fresh);
});

test("acknowledged saves update a retained draft revision but remote refreshes do not", () => {
  const old = { topology_revision: 4, rooms: [] };
  const draft = { topology_revision: 4, rooms: [{ id: "local" }] };
  const saved = { topology_revision: 5, rooms: [{ id: "saved" }] };
  const previous = { floorId: 1, data: old };
  assert.deepEqual(reconcileWorkspaceRefresh(draft, previous, 1, saved, true), {
    topology_revision: 5, rooms: [{ id: "local" }],
  });
  assert.equal(reconcileWorkspaceRefresh(draft, previous, 1, saved).topology_revision, 4);
});
