import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundled = buildSync({
  entryPoints: [new URL("../src/features/projects/domain/schematic.ts", import.meta.url).pathname],
  bundle: true,
  format: "esm",
  write: false,
  logLevel: "silent",
}).outputFiles[0].text;
const schematic = await import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);

const rcd = { id: "rcd-1", name: "FI 1", rated_current_ma: 30, poles: 4, type: "A", upstream_id: null, price: 0 };
const circuit = {
  id: "circuit-1",
  name: "Lighting",
  rcd_id: "rcd-1",
  breaker_type: "B",
  rated_current_a: 10,
  poles: 1,
  cable: "3G1.5",
  loads: ["load-1"],
  supply: "1n",
  price: 0,
};
const load = {
  id: "load-1",
  kind: "light",
  label: "Hall light",
  x: 0,
  y: 0,
  rotation: 0,
  room_id: null,
  mounting_point_id: null,
  circuit_id: "circuit-1",
  device_id: null,
  channel_id: null,
  layer_id: "installation",
  color: "#000",
  element_id: null,
  bus_address: null,
  cable_type: null,
  target_location: null,
  metadata: {},
};

test("maps stored protection, circuit and load topology without assigning phases or terminals", () => {
  const model = schematic.buildSchematicModel({ rcds: [rcd], circuits: [circuit], placements: [load] });
  assert.equal(model.groups.length, 1);
  assert.equal(model.groups[0].rcd.id, "rcd-1");
  assert.equal(model.groups[0].circuits[0].circuit.id, "circuit-1");
  assert.equal(model.groups[0].circuits[0].loads[0].placement.id, "load-1");
  assert.deepEqual(model.groups[0].circuits[0].poles, [1]);
  assert.deepEqual(model.issues, []);
});

test("reports disconnected circuits and dangling load references", () => {
  const disconnected = { ...circuit, id: "circuit-orphan", rcd_id: "missing-rcd", loads: ["missing-load"] };
  const model = schematic.buildSchematicModel({ rcds: [], circuits: [disconnected], placements: [] });
  assert.deepEqual(model.disconnectedCircuits.map((item) => item.circuit.id), ["circuit-orphan"]);
  assert.deepEqual(model.issues.map((issue) => issue.code), ["missing-rcd", "missing-load"]);
  assert.equal(model.disconnectedCircuits[0].missingLoadIds[0], "missing-load");
});

test("resolves cross-floor circuit loads from project-wide placements without inventing fields", () => {
  const remotePlacement = { id: "load-1", floor_id: 42, floor_name: "Upper floor", label: "Bedroom socket" };
  const model = schematic.buildSchematicModel(
    { rcds: [rcd], circuits: [circuit], placements: [] },
    { placements: [remotePlacement], status: "available" },
  );
  const loadEntry = model.groups[0].circuits[0].loads[0];
  assert.deepEqual(loadEntry, { source: "project", placement: remotePlacement });
  assert.equal(model.groups[0].circuits[0].missingLoadIds.length, 0);
  assert.deepEqual(model.issues, []);
});

test("local unsaved placements take precedence over project-wide placement metadata", () => {
  const localUnsavedLoad = { ...load, label: "Unsaved local label" };
  const model = schematic.buildSchematicModel(
    { rcds: [rcd], circuits: [circuit], placements: [localUnsavedLoad] },
    { placements: [{ id: load.id, floor_id: 42, floor_name: "Remote floor", label: "Stale remote label" }], status: "available" },
  );
  assert.deepEqual(model.groups[0].circuits[0].loads[0], { source: "local", placement: localUnsavedLoad });
});

test("does not report missing loads while project-wide placements are loading or unavailable", () => {
  for (const status of ["loading", "unavailable"]) {
    const model = schematic.buildSchematicModel(
      { rcds: [rcd], circuits: [circuit], placements: [] },
      { status },
    );
    assert.deepEqual(model.issues.map((issue) => issue.code), []);
    assert.deepEqual(model.groups[0].circuits[0].missingLoadIds, []);
    assert.deepEqual(model.groups[0].circuits[0].unresolvedLoadIds, ["load-1"]);
    assert.equal(model.remotePlacementsStatus, status);
  }
});

test("reports missing loads when the complete project-wide placement list is available", () => {
  const model = schematic.buildSchematicModel(
    { rcds: [rcd], circuits: [circuit], placements: [] },
    { placements: [], status: "available" },
  );
  assert.deepEqual(model.issues.map((issue) => issue.code), ["missing-load"]);
});

test("reports conflicting and unlisted stored load assignments", () => {
  const secondCircuit = { ...circuit, id: "circuit-2", rcd_id: "rcd-1", loads: [] };
  const model = schematic.buildSchematicModel({
    rcds: [rcd],
    circuits: [circuit, secondCircuit],
    placements: [
      { ...load, circuit_id: "circuit-2" },
      { ...load, id: "load-2", circuit_id: "circuit-2" },
      { ...load, id: "load-3", circuit_id: "missing-circuit" },
    ],
  });
  assert.deepEqual(model.issues.map((issue) => issue.code), ["conflicting-load-assignment", "unlisted-circuit-load", "missing-circuit"]);
});

test("reports missing upstream protection and protection cycles", () => {
  const a = { ...rcd, id: "a", upstream_id: "b" };
  const b = { ...rcd, id: "b", upstream_id: "a" };
  const orphan = { ...rcd, id: "orphan", upstream_id: "not-found" };
  const model = schematic.buildSchematicModel({ rcds: [a, b, orphan], circuits: [], placements: [] });
  assert.deepEqual(model.issues.map((issue) => issue.code), ["missing-upstream-rcd", "rcd-cycle"]);
});
