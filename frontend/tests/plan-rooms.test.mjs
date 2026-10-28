import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundled = buildSync({
  entryPoints: [new URL("../src/features/projects/domain/plan-rooms.ts", import.meta.url).pathname],
  bundle: true,
  format: "esm",
  write: false,
  logLevel: "silent",
}).outputFiles[0].text;
const r = await import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);
const detection = await import(`data:text/javascript;base64,${Buffer.from(buildSync({
  entryPoints: [new URL("../src/features/projects/domain/room-detection.ts", import.meta.url).pathname],
  bundle: true, format: "esm", write: false, logLevel: "silent",
}).outputFiles[0].text).toString("base64")}`);

const rect = { id: "a", name: "Hall", x: 100, y: 100, width: 200, height: 100, color: "#eaf3f1", layer_id: "installation" };
const pts = (...list) => list.map(([x, y]) => ({ x, y }));

function wallImage(width, height, boxes) {
  const data = new Uint8Array(width * height).fill(255);
  for (const [x0, y0, x1, y1] of boxes) for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) data[y * width + x] = 0;
  return { data, width, height, channels: 1 };
}

test("legacy rectangle rooms are untouched by the helpers", () => {
  assert.equal(r.hasPolygon(rect), false);
  assert.deepEqual(r.translateRoom(rect, 120, 110), { ...rect, x: 120, y: 110 });
  assert.equal(r.roomContains(rect, 150, 150), true);
  assert.equal(r.roomContains(rect, 301, 150), false);
  assert.equal(r.roomPath(rect), "M100,100L300,100L300,200L100,200Z");
  assert.deepEqual(r.labelAnchor(rect), { x: 200, y: 150 });
  assert.equal(r.moveRoomVertex(rect, 0, { x: 0, y: 0 }), null);
  assert.equal(r.splitRoom(rect, 0, 2, "b"), null);
});

test("area uses calibration (m per 100 units) and subtracts holes", () => {
  assert.equal(r.roomAreaM2(rect, null), null);
  assert.ok(Math.abs(r.roomAreaM2(rect, 5) - 200 * 100 * 0.05 ** 2) < 1e-9);
  const holed = r.withOutline(rect, pts([0, 0], [100, 0], [100, 100], [0, 100]), [pts([10, 10], [20, 10], [20, 20], [10, 20])]);
  assert.ok(Math.abs(r.roomAreaM2(holed, 10) - (10000 - 100) * 0.1 ** 2) < 1e-9);
  assert.equal(r.roomContains(holed, 15, 15), false);
  assert.equal(r.roomContains(holed, 50, 50), true);
});

test("polygon conversion keeps bounds in sync and dragging carries outline and holes", () => {
  const poly = r.toPolygonRoom(rect);
  assert.deepEqual(poly.polygon, [[100, 100], [300, 100], [300, 200], [100, 200]]);
  const moved = r.translateRoom({ ...poly, holes: [[[110, 110], [120, 110], [120, 120]]] }, 150, 130);
  assert.deepEqual(moved.polygon[0], [150, 130]);
  assert.deepEqual(moved.holes[0][0], [160, 140]);
  assert.equal(moved.x, 150);
});

test("vertex edit helpers keep bbox and reject self-intersecting results", () => {
  const poly = r.toPolygonRoom(rect);
  const widened = r.moveRoomVertex(poly, 1, { x: 400, y: 100 });
  assert.equal(widened.width, 300);
  assert.equal(r.moveRoomVertex(poly, 1, { x: 300, y: 250 }), null); // bow-tie
  assert.equal(r.moveRoomVertex(poly, 1, { x: 5000, y: -50 }).x, 100); // clamped to canvas
  const inserted = r.insertRoomVertex(poly, 0);
  assert.equal(inserted.polygon.length, 5);
  assert.deepEqual(inserted.polygon[1], [200, 100]);
  assert.equal(r.deleteRoomVertex(inserted, 1).polygon.length, 4);
  assert.equal(r.deleteRoomVertex(poly, 1).polygon.length, 3);
  assert.equal(r.deleteRoomVertex(r.deleteRoomVertex(poly, 1), 0), null); // never below 3 vertices
});

test("split gives two valid rooms, new id, hole follows its part", () => {
  const poly = r.withOutline(rect, pts([100, 100], [300, 100], [300, 200], [200, 200], [100, 200]), [pts([110, 110], [120, 110], [120, 120], [110, 120])]);
  const parts = r.splitRoom(poly, 1, 4, "new");
  assert.ok(parts);
  const [kept, created] = parts;
  assert.equal(kept.id, "a");
  assert.equal(created.id, "new");
  assert.equal(kept.holes.length + created.holes.length, 1);
  const areas = parts.map((room) => r.roomAreaM2(room, 100));
  assert.ok(Math.abs(areas[0] + areas[1] - (200 * 100 - 100)) < 1e-6);
  assert.equal(r.splitRoom(poly, 0, 1, "n"), null); // adjacent
});

test("label anchor stays inside concave rooms", () => {
  const u = r.withOutline(rect, pts([0, 0], [300, 0], [300, 300], [200, 300], [200, 100], [100, 100], [100, 300], [0, 300]), []);
  const anchor = r.labelAnchor(u);
  assert.equal(r.roomContains(u, anchor.x, anchor.y), true);
});

test("detected rooms are flagged for review, de-duplicated and capped", () => {
  const image = wallImage(100, 70, [[10, 10, 50, 12], [10, 50, 50, 52], [10, 10, 12, 52], [48, 10, 50, 52]]);
  const [region] = detection.detectRooms(image, { plan: { crop: null } });
  const candidate = { polygon: region.polygon, holes: region.holes };
  let counter = 0;
  const make = () => `id${(counter += 1)}`;
  const { rooms } = r.buildDetectedRooms([candidate], [rect], "installation", make, (n) => `Detected room ${n}`);
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0].source, "detected");
  assert.equal(rooms[0].needs_review, true);
  assert.equal(rooms[0].name, "Detected room 1");
  assert.ok(rooms[0].polygon.every(([x, y]) => x >= 0 && x <= 1000 && y >= 0 && y <= 700));
  assert.ok(Math.abs(rooms[0].x - (12 / 100) * 1000) < 1e-6);
  const again = r.buildDetectedRooms([candidate], [rect, ...rooms], "installation", make, (n) => `Detected room ${n}`);
  assert.equal(again.rooms.length, 0);
  assert.equal(again.skipped, 1);
  const full = r.buildDetectedRooms([candidate], Array.from({ length: 100 }, (_, i) => ({ ...rect, id: `r${i}` })), "installation", make, String);
  assert.equal(full.rooms.length, 0);
});

test("oversized detected outlines are simplified under the vertex limit or dropped", () => {
  const zigzag = [];
  for (let i = 0; i < 300; i += 1) zigzag.push({ x: 10 + i * 3, y: i % 2 === 0 ? 100 : 100.4 });
  zigzag.push({ x: 910, y: 400 }, { x: 10, y: 400 });
  const { rooms } = r.buildDetectedRooms([{ polygon: zigzag, holes: [] }], [], "installation", () => "z", String);
  for (const room of rooms) assert.ok(room.polygon.length <= 200);
});

const holed = () => r.withOutline(rect, pts([100, 100], [300, 100], [300, 200], [100, 200]), [pts([180, 130], [220, 130], [220, 170], [180, 170])]);

test("vertex edits that would cross or touch a hole are rejected", () => {
  const room = holed();
  assert.ok(r.moveRoomVertex(room, 1, { x: 320, y: 100 }));
  // Dent the right edge so the outline sweeps over the hole.
  const withNotch = r.insertRoomVertex(room, 1);
  assert.equal(r.moveRoomVertex(withNotch, 2, { x: 200, y: 150 }), null);
  assert.equal(r.moveRoomVertex(withNotch, 2, { x: 220, y: 150 }), null); // lands on the hole edge
  assert.ok(r.moveRoomVertex(withNotch, 2, { x: 280, y: 150 }));
  // Moving a corner so the outline leaves the hole outside.
  assert.equal(r.moveRoomVertex(room, 0, { x: 230, y: 120 }), null);
  assert.equal(r.moveRoomVertex(room, 2, { x: 150, y: 150 }), null);
  assert.equal(r.deleteRoomVertex(r.insertRoomVertex(room, 0), 1)?.polygon.length, 4);
});

test("deleting a vertex that would cut off a hole is rejected", () => {
  const poly = r.withOutline(rect, pts([100, 100], [300, 100], [300, 200], [200, 200], [100, 200]), [pts([110, 180], [130, 180], [130, 195], [110, 195])]);
  assert.equal(r.deleteRoomVertex(poly, 4), null);
  assert.ok(r.deleteRoomVertex(poly, 3));
});

test("splitting is rejected when the chord touches or passes through a hole, accepted when it misses", () => {
  const room = holed();
  assert.equal(r.splitRoom(room, 0, 2, "n"), null); // diagonal crosses the hole
  const sixSided = r.withOutline(rect, pts([100, 100], [200, 100], [300, 100], [300, 200], [200, 200], [100, 200]), [pts([120, 130], [150, 130], [150, 170], [120, 170])]);
  const parts = r.splitRoom(sixSided, 1, 4, "n"); // vertical cut at x=200 misses the hole
  assert.ok(parts);
  assert.equal(parts[0].holes.length + parts[1].holes.length, 1);
  const onHole = r.withOutline(rect, pts([100, 100], [200, 100], [300, 100], [300, 200], [200, 200], [100, 200]), [pts([180, 130], [220, 130], [220, 170], [180, 170])]);
  assert.equal(r.splitRoom(onHole, 1, 4, "n"), null); // cut runs through the hole
  assert.equal(r.buildDetectedRooms([{ polygon: pts([100, 100], [300, 100], [300, 200], [100, 200]), holes: [pts([90, 130], [150, 130], [150, 170], [90, 170])] }], [], "l", () => "x", String).rooms.length, 0);
});
