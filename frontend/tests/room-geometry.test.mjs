import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundled = buildSync({
  entryPoints: [new URL("../src/features/projects/domain/room-geometry.ts", import.meta.url).pathname],
  bundle: true, format: "esm", write: false, logLevel: "silent",
}).outputFiles[0].text;
const g = await import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);

const room = (id, x, y, width, height, extra = {}) => ({ id, name: id, x, y, width, height, color: "#fff", layer_id: "l", ...extra });
const area = (r) => g.geometryArea(g.mergeGeometries ? r.polygon.map(([x, y]) => ({ x, y })) : [], (r.holes ?? []).map((h) => h.map(([x, y]) => ({ x, y }))));
const ok = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };

test("merges two rectangles sharing a full edge into one outline", () => {
  const merged = ok(g.mergeRooms(room("a", 0, 0, 100, 100), room("b", 100, 0, 50, 100)));
  assert.equal(merged.id, "a");
  assert.deepEqual([merged.x, merged.y, merged.width, merged.height], [0, 0, 150, 100]);
  assert.equal(merged.polygon.length, 4);
  assert.equal(area(merged), 15000);
});

test("merges partially shared edges (T-junction) into an L shape", () => {
  const merged = ok(g.mergeRooms(room("a", 0, 0, 100, 100), room("b", 100, 20, 50, 40)));
  assert.equal(merged.polygon.length, 8);
  assert.equal(area(merged), 10000 + 2000);
});

test("preserves holes of both rooms", () => {
  const a = ok(g.addRoomHole(room("a", 0, 0, 100, 100), g.rectangleRing(10, 10, 20, 20)));
  const b = ok(g.addRoomHole(room("b", 100, 0, 100, 100), g.rectangleRing(150, 40, 10, 10)));
  const merged = ok(g.mergeRooms(a, b));
  assert.equal(merged.holes.length, 2);
  assert.equal(area(merged), 20000 - 400 - 100);
});

test("merge order does not change area; result is valid", () => {
  const a = room("a", 0, 0, 100, 100);
  const b = room("b", 0, 100, 60, 40);
  assert.equal(area(ok(g.mergeRooms(a, b))), area(ok(g.mergeRooms(b, a))));
});

test("filling a hole completely closes it", () => {
  const a = ok(g.addRoomHole(room("a", 0, 0, 100, 100), g.rectangleRing(10, 10, 20, 20)));
  const merged = ok(g.mergeRooms(a, room("plug", 10, 10, 20, 20)));
  assert.equal(merged.holes.length, 0);
  assert.equal(area(merged), 10000);
});

test("rejects nonadjacent, corner-touching, overlapping and identical rooms", () => {
  const a = room("a", 0, 0, 100, 100);
  assert.equal(g.mergeRooms(a, room("b", 200, 0, 50, 50)).code, "not-adjacent");
  assert.equal(g.mergeRooms(a, room("b", 100, 100, 50, 50)).code, "not-adjacent");
  assert.equal(g.mergeRooms(a, room("b", 50, 50, 100, 100)).code, "overlap");
  assert.equal(g.mergeRooms(a, room("b", 0, 0, 100, 100)).code, "overlap");
  assert.equal(g.mergeRooms(a, room("b", 25, 25, 20, 20)).code, "overlap");
  assert.equal(g.mergeRooms(a, room("b", 100, -20, 50, 60)).ok, true);
  assert.equal(g.mergeRooms(a, room("b", 50, 100, 100, 20, { x: 50 })).ok, true);
  assert.equal(g.mergeRooms(a, room("b", 50, 20, 100, 20)).code, "overlap");
  assert.equal(g.mergeRooms(a, a).code, "same-room");
  assert.equal(g.mergeRooms(a, room("b", 100, 0, 50, 100, { layer_id: "other" })).code, "layer-mismatch");
});

test("rejects merges that only touch at points or would pinch the outline", () => {
  const u = { id: "u", name: "u", x: 0, y: 0, width: 100, height: 100, color: "#fff", layer_id: "l",
    polygon: [[0, 0], [100, 0], [100, 100], [60, 100], [60, 40], [40, 40], [40, 100], [0, 100]] };
  assert.equal(g.mergeRooms(u, room("cap", 40, 100, 20, 10)).ok, false);
  assert.equal(g.mergeRooms(u, room("plug", 40, 40, 20, 60)).ok, true);
  assert.equal(area(ok(g.mergeRooms(u, room("r", 60, 100, 40, 20)))), 8800 + 800);
  const a = room("a", 0, 0, 100, 100);
  const b = ok(g.mergeRooms(a, room("b", 100, 0, 50, 50)));
  assert.equal(g.mergeRooms(b, room("c", 100, 50, 50, 50)).ok, true);
});

test("manual holes: add, replace, remove and validation", () => {
  const base = room("a", 0, 0, 100, 100);
  const withHole = ok(g.addRoomHole(base, g.rectangleRing(10, 10, 20, 20)));
  assert.equal(area(withHole), 9600);
  assert.equal(g.addRoomHole(withHole, g.rectangleRing(25, 25, 20, 20)).ok, false);
  assert.equal(g.addRoomHole(withHole, g.rectangleRing(-5, 10, 20, 20)).code, "hole-out-of-range");
  assert.equal(g.addRoomHole(withHole, g.rectangleRing(0, 40, 10, 10)).ok, false);
  assert.equal(g.addRoomHole(base, [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]).ok, false);
  assert.equal(g.addRoomHole(base, [{ x: 10, y: 10 }, { x: 30, y: 30 }, { x: 30, y: 10 }, { x: 10, y: 30 }]).ok, false);
  const replaced = ok(g.replaceRoomHole(withHole, 0, g.rectangleRing(40, 40, 10, 10)));
  assert.equal(area(replaced), 9900);
  const removed = ok(g.removeRoomHole(replaced, 0));
  assert.equal(removed.holes.length, 0);
  assert.equal(g.removeRoomHole(removed, 0).ok, false);
});

test("area stays precise far from the origin", () => {
  const big = g.geometryArea(g.rectangleRing(1e6, 1e6, 0.5, 0.25));
  assert.equal(big, 0.125);
});
