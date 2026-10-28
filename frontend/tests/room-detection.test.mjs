import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../src/features/projects/domain/room-detection.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);

function plan(width, height, draw) {
  const data = new Uint8Array(width * height).fill(255);
  const rect = (x0, y0, x1, y1) => {
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) data[y * width + x] = 0;
  };
  draw(rect, data);
  return { data, width, height, channels: 1 };
}

test("two closed rooms: exact areas and rectangular contours", () => {
  const image = plan(60, 40, (rect) => {
    rect(5, 5, 55, 7); rect(5, 33, 55, 35); rect(5, 5, 7, 35); rect(53, 5, 55, 35); rect(29, 5, 31, 35);
  });
  const rooms = m.detectRooms(image, { metersPerPlanUnit: 0.01 });
  assert.equal(rooms.length, 2);
  const sx = 1000 / 60;
  const sy = 700 / 40;
  const left = rooms.find((r) => Math.abs(r.bounds.x - 7 * sx) < 1e-6);
  assert.equal(left.areaPx, 22 * 26);
  assert.ok(Math.abs(left.areaM2 - 22 * 26 * sx * sy * 1e-4) < 1e-9);
  assert.equal(left.polygon.length, 4);
  assert.ok(Math.abs(m.polygonAreaM2(left.polygon, 0.01) - left.areaM2) < 1e-9);
  assert.ok(rooms.every((r) => r.polygon.every((p) => p.x >= 7 * sx - 1e-6 && p.x <= 53 * sx + 1e-6)));
});

test("open door gap merges rooms through the exterior unless bridged", () => {
  const leaky = plan(60, 40, (rect) => {
    rect(5, 5, 55, 7); rect(5, 33, 55, 35); rect(5, 5, 7, 35); rect(53, 5, 55, 35);
    rect(29, 5, 31, 15); rect(29, 19, 31, 35);
  });
  const open = m.detectRooms(leaky);
  assert.equal(open.length, 1);
  assert.equal(open[0].areaPx, 46 * 26 - 2 * 8 - 2 * 14);
  const bridged = m.detectRooms(leaky, { gapClosePx: 3 });
  assert.equal(bridged.length, 2);
  assert.equal(bridged[0].areaPx + bridged[1].areaPx, open[0].areaPx);
});

test("a gap in the outer wall leaks to the exterior and the room is dropped", () => {
  const image = plan(40, 40, (rect) => {
    rect(5, 5, 35, 7); rect(5, 33, 35, 35); rect(5, 5, 7, 35); rect(33, 5, 35, 15); rect(33, 20, 35, 35);
  });
  assert.equal(m.detectRooms(image).length, 0);
  assert.equal(m.detectRooms(image, { gapClosePx: 3 }).length, 1);
});

test("L-shaped room yields a six-vertex polygon; pillar becomes a hole subtracted from area", () => {
  const l = plan(50, 50, (rect) => {
    rect(5, 5, 45, 7); rect(5, 5, 7, 45); rect(5, 43, 25, 45); rect(43, 5, 45, 25);
    rect(25, 25, 45, 27); rect(25, 25, 27, 45);
  });
  const [room] = m.detectRooms(l);
  assert.equal(room.polygon.length, 6);

  const pillar = plan(50, 50, (rect) => {
    rect(5, 5, 45, 7); rect(5, 43, 45, 45); rect(5, 5, 7, 45); rect(43, 5, 45, 45); rect(20, 20, 26, 26);
  });
  const [withPillar] = m.detectRooms(pillar);
  assert.equal(withPillar.holes.length, 1);
  assert.equal(withPillar.areaPx, 36 * 36 - 36);
  assert.equal(withPillar.polygon.length, 4);
});

test("speckles are ignored, text-like blobs inside rooms do not create holes", () => {
  const image = plan(50, 50, (rect) => {
    rect(5, 5, 45, 7); rect(5, 43, 45, 45); rect(5, 5, 7, 45); rect(43, 5, 45, 45);
    rect(20, 20, 22, 22); rect(30, 15, 31, 16);
  });
  const [room] = m.detectRooms(image);
  assert.equal(room.holes.length, 0);
  assert.equal(room.areaPx, 36 * 36);
});

test("otsu threshold handles grey scan backgrounds", () => {
  const image = plan(50, 50, (rect, data) => {
    data.fill(200);
    rect(5, 5, 45, 7); rect(5, 43, 45, 45); rect(5, 5, 7, 45); rect(43, 5, 45, 45);
  });
  assert.equal(m.detectRooms(image, { threshold: "otsu" }).length, 1);
  assert.equal(m.detectRooms(image, { threshold: 128 }).length, 1);
});

test("RGBA input and plan-unit scaling", () => {
  const g = plan(30, 30, (rect) => { rect(5, 5, 25, 7); rect(5, 23, 25, 25); rect(5, 5, 7, 25); rect(23, 5, 25, 25); });
  const data = new Uint8ClampedArray(30 * 30 * 4);
  for (let i = 0; i < 900; i += 1) data.set([g.data[i], g.data[i], g.data[i], 255], i * 4);
  const [room] = m.detectRooms({ data, width: 30, height: 30 });
  assert.ok(Math.abs(room.bounds.x - (7 / 30) * 1000) < 1e-6);
  assert.ok(Math.abs(room.bounds.height - (16 / 30) * 700) < 1e-6);
  assert.equal(room.areaM2, null);
});

test("crop window maps to the plan and cut-off rooms are dropped as exterior", () => {
  // Room at 20..60 of a 100x100 raster; crop shows x 10..70 / y 10..70 (fractions 0.1, 0.6).
  const g = plan(100, 100, (rect) => { rect(20, 20, 60, 22); rect(20, 58, 60, 60); rect(20, 20, 22, 60); rect(58, 20, 60, 60); });
  const [room] = m.detectRooms(g, { plan: { crop: [0.1, 0.1, 0.6, 0.6] }, metersPerPlanUnit: 0.01 });
  assert.ok(Math.abs(room.bounds.x - ((22 - 10) / 60) * 1000) < 1e-6);
  assert.ok(Math.abs(room.bounds.y - ((22 - 10) / 60) * 700) < 1e-6);
  assert.ok(Math.abs(room.areaM2 - 36 * 36 * (1000 / 60) * (700 / 60) * 1e-4) < 1e-9);
  assert.equal(m.detectRooms(g, { plan: { crop: [0.3, 0.1, 0.5, 0.6] } }).length, 0);
  assert.equal(m.detectRooms(g, { plan: { crop: [0.5, 0.5, 0.8, 0.8] } }).length, 0);
});

test("rotation keeps area and stays inside the plan; rooms rotated out are dropped", () => {
  const g = plan(100, 70, (rect) => { rect(40, 25, 60, 27); rect(40, 43, 60, 45); rect(40, 25, 42, 45); rect(58, 25, 60, 45); });
  const base = m.detectRooms(g, { metersPerPlanUnit: 0.01 })[0];
  const turned = m.detectRooms(g, { metersPerPlanUnit: 0.01, plan: { rotationDeg: 90 } })[0];
  assert.ok(Math.abs(turned.areaM2 - base.areaM2) < 1e-9);
  assert.ok(Math.abs(m.polygonArea(turned.polygon) - m.polygonArea(base.polygon)) < 1e-6);
  const near = plan(100, 70, (rect) => { rect(1, 1, 21, 3); rect(1, 19, 21, 21); rect(1, 1, 3, 21); rect(19, 1, 21, 21); });
  assert.equal(m.detectRooms(near, { plan: { rotationDeg: 45 } }).length, 0);
});

test("page frame around a drawing is not reported as a room", () => {
  const g = plan(80, 80, (rect) => {
    rect(2, 2, 78, 3); rect(2, 77, 78, 78); rect(2, 2, 3, 78); rect(77, 2, 78, 78);
    rect(20, 20, 60, 22); rect(20, 58, 60, 60); rect(20, 20, 22, 60); rect(58, 20, 60, 60);
  });
  const rooms = m.detectRooms(g);
  assert.equal(rooms.length, 1);
  assert.ok(rooms[0].areaPx === 36 * 36);
});

test("polygons are simple and never exceed the true outline on noisy diagonal walls", () => {
  const g = plan(120, 120, (rect, data) => {
    rect(10, 10, 110, 12); rect(10, 108, 110, 110); rect(10, 10, 12, 110); rect(108, 10, 110, 110);
    for (let i = 0; i < 40; i += 1) { const x = 40 + i; rect(x, 40 + i, x + 3, 43 + i); }
    for (let k = 0; k < 40; k += 1) data[(15 + ((k * 37) % 90)) * 120 + 15 + ((k * 53) % 90)] = 0;
  });
  const rooms = m.detectRooms(g, { simplifyEpsilonPx: 3 });
  assert.ok(rooms.length >= 1);
  for (const room of rooms) {
    assert.ok(m.isSimplePolygon(room.polygon));
    const sx = 1000 / 120;
    const sy = 700 / 120;
    assert.ok(Math.abs(m.polygonArea(room.polygon) - (room.areaPx + room.holes.reduce((a, h) => a + m.polygonArea(h) / (sx * sy), 0)) * sx * sy) < 0.06 * room.areaPx * sx * sy);
    assert.ok(room.polygon.every((p) => p.x >= 0 && p.x <= 1000 && p.y >= 0 && p.y <= 700));
  }
});

test("calibration and polygon area", () => {
  const scale = m.calibrateMetersPerUnit({ x: 0, y: 0 }, { x: 0, y: 200 }, 4);
  assert.equal(scale, 0.02);
  const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  assert.ok(Math.abs(m.polygonAreaM2(square, scale) - 4) < 1e-9);
  assert.equal(m.calibrateMetersPerUnit({ x: 1, y: 1 }, { x: 1, y: 1 }, 4), null);
  assert.equal(m.metersPerUnitFromScale(5), 0.05);
  assert.equal(m.metersPerUnitFromScale(null), null);
});

test("vertex edit helpers are pure", () => {
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  const frozen = JSON.stringify(square);
  assert.deepEqual(m.insertVertex(square, 0)[1], { x: 5, y: 0 });
  assert.equal(m.insertVertex(square, 3).length, 5);
  assert.deepEqual(m.moveVertex(square, 2, { x: 12, y: 12 })[2], { x: 12, y: 12 });
  assert.equal(m.deleteVertex(square, 1).length, 3);
  assert.equal(m.deleteVertex(m.deleteVertex(square, 1), 0).length, 3);
  assert.equal(JSON.stringify(square), frozen);
});

test("split polygon along a chord; rejects invalid chords", () => {
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  const [a, b] = m.splitPolygon(square, 0, 2);
  assert.equal(m.polygonArea(a) + m.polygonArea(b), 100);
  assert.equal(m.splitPolygon(square, 0, 1), null);
  assert.equal(m.splitPolygon(square, 0, 3), null);
  // U shape: chord across the notch lies outside.
  const u = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }, { x: 20, y: 30 }, { x: 20, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 30 }, { x: 0, y: 30 }];
  assert.equal(m.splitPolygon(u, 5, 4), null);
  assert.equal(m.splitPolygon(u, 3, 6), null);
  const parts = m.splitPolygon(u, 4, 5);
  assert.equal(parts, null);
  const ok = m.splitPolygon(u, 0, 4);
  assert.ok(ok);
  assert.equal(m.polygonArea(ok[0]) + m.polygonArea(ok[1]), m.polygonArea(u));
  assert.ok(m.isSimplePolygon(square));
  assert.ok(!m.isSimplePolygon([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }]));
});

const planCrop = await (async () => {
  const { buildSync } = await import("esbuild");
  const out = buildSync({ entryPoints: [new URL("../src/features/projects/domain/plan-crop.ts", import.meta.url).pathname], bundle: true, format: "esm", write: false, logLevel: "silent" }).outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(out).toString("base64")}`);
})();

test("detector with persisted registration places rooms where the helper maps them, at any rotation", () => {
  const g = plan(100, 80, (rect) => { rect(20, 20, 70, 22); rect(20, 58, 70, 60); rect(20, 20, 22, 60); rect(68, 20, 70, 60); });
  const legacyCrop = [0.1, 0.1, 0.8, 0.8];
  for (const deg of [0, 90, 180]) {
    const legacyRoom = m.detectRooms(g, { metersPerPlanUnit: 0.01, plan: { crop: legacyCrop, rotationDeg: deg } });
    const edited = planCrop.editCrop({ image_crop: legacyCrop }, [0.15, 0.15, 0.6, 0.6]);
    const reg = planCrop.resolveRegistration(edited);
    const room = m.detectRooms(g, { metersPerPlanUnit: 0.01, plan: { crop: edited.image_crop, registration: reg, rotationDeg: deg } });
    assert.equal(room.length, legacyRoom.length);
    assert.equal(room.length, 1);
    // same plan geometry and scale as before the edit
    assert.ok(room[0].areaM2 > 0);
    assert.ok(Math.abs(room[0].areaM2 - legacyRoom[0].areaM2) < 1e-9);
    const key = (r) => r.polygon.map((q) => [Math.round(q.x * 1e6) / 1e6, Math.round(q.y * 1e6) / 1e6]).sort().join("|");
    assert.equal(key(room[0]), key(legacyRoom[0]));
    const corner = planCrop.rasterToPlan({ x: 22, y: 22 }, 100, 80, reg, deg);
    assert.ok(room[0].polygon.some((q) => Math.hypot(q.x - corner.x, q.y - corner.y) < 1e-6));
  }
  // omitting registration keeps the legacy stretched mapping
  const stretched = m.detectRooms(g, { plan: { crop: [0.15, 0.15, 0.6, 0.6] } });
  const fixed = m.detectRooms(g, { plan: { crop: [0.15, 0.15, 0.6, 0.6], registration: legacyCrop } });
  assert.notEqual(stretched.length === 1 && fixed.length === 1 && stretched[0].polygon[0].x === fixed[0].polygon[0].x, true);
});
