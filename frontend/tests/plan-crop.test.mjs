import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundled = buildSync({
  entryPoints: [new URL("../src/features/projects/domain/plan-crop.ts", import.meta.url).pathname],
  bundle: true, format: "esm", write: false, logLevel: "silent",
}).outputFiles[0].text;
const c = await import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const nearPt = (p, q) => { near(p.x, q.x); near(p.y, q.y); };

// The previous editor render, reproduced verbatim.
const legacyImage = (crop) => {
  const [cx, cy, cw, ch] = crop ?? [0, 0, 1, 1];
  const width = 1000 / cw, height = 700 / ch;
  return { x: -cx * width, y: -cy * height, width, height };
};

test("legacy data (no reference) renders exactly like the old stretched view", () => {
  for (const crop of [null, [0.05, 0.05, 0.9, 0.9], [0.25, 0.1, 0.5, 0.3]]) {
    const l = c.cropLayout({ image_crop: crop }, 90);
    assert.deepEqual(l.image, legacyImage(crop));
    assert.equal(l.clip, null);
    assert.equal(l.transform, "rotate(90,500,350)");
  }
  assert.equal(c.cropLayout({ image_crop: null }, 0).transform, undefined);
});

test("first edit persists the old crop (or full image) as reference", () => {
  assert.deepEqual(c.editCrop({ image_crop: [0.1, 0.1, 0.5, 0.5] }, [0.2, 0.2, 0.3, 0.3]),
    { image_crop: [0.2, 0.2, 0.3, 0.3], image_crop_reference: [0.1, 0.1, 0.5, 0.5] });
  assert.deepEqual(c.editCrop({ image_crop: null }, [0.05, 0.05, 0.9, 0.9]),
    { image_crop: [0.05, 0.05, 0.9, 0.9], image_crop_reference: [0, 0, 1, 1] });
  const again = c.editCrop({ image_crop: [0.2, 0.2, 0.3, 0.3], image_crop_reference: [0.1, 0.1, 0.5, 0.5] }, null);
  assert.deepEqual(again, { image_crop: null, image_crop_reference: [0.1, 0.1, 0.5, 0.5] });
});

test("editing keeps image rect, scale and registration fixed; only the clip changes", () => {
  const legacy = { image_crop: [0.1, 0.2, 0.5, 0.4] };
  const before = c.cropLayout(legacy, 33);
  let state = c.editCrop(legacy, [0.2, 0.3, 0.3, 0.2]);
  for (const next of [[0.15, 0.25, 0.4, 0.3], [0.1, 0.2, 0.5, 0.4], null, [0, 0, 1, 1]]) state = c.editCrop(state, next);
  const after = c.cropLayout(state, 33);
  assert.deepEqual(after.image, before.image);
  assert.deepEqual(state.image_crop_reference, [0.1, 0.2, 0.5, 0.4]);
  // returning to the original crop shows the original view
  assert.deepEqual(c.cropLayout(c.editCrop(state, [0.1, 0.2, 0.5, 0.4]), 33).clip, before.clip);
});

test("source point keeps its plan position across crop edits at any rotation", () => {
  const src = { x: 0.3, y: 0.45 };
  for (const deg of [0, 90, 180, 270, 37, -20]) {
    const state0 = { image_crop: [0.1, 0.2, 0.5, 0.4] };
    const p0 = c.imageToPlan(src, c.resolveRegistration(state0), deg);
    const state1 = c.editCrop(state0, [0.25, 0.3, 0.3, 0.2]);
    const p1 = c.imageToPlan(src, c.resolveRegistration(state1), deg);
    nearPt(p0, p1);
    nearPt(c.planToImage(p1, c.resolveRegistration(state1), deg), src);
  }
});

test("physical scale is constant: raster pixel area and m² do not change with crop edits", () => {
  const state0 = { image_crop: [0.1, 0.2, 0.5, 0.4] };
  const state1 = c.editCrop(state0, [0.2, 0.3, 0.2, 0.2]);
  near(c.planAreaPerRasterPixel(2000, 1400, c.resolveRegistration(state0)), c.planAreaPerRasterPixel(2000, 1400, c.resolveRegistration(state1)));
  near(c.planAreaToSquareMeters(100 * 100, 2), 4);
});

test("raster mapping matches the old stretched mapping for legacy data and is crop independent after edit", () => {
  const crop = [0.25, 0.5, 0.5, 0.25];
  const legacy = c.rasterToPlan({ x: 1000, y: 800 }, 2000, 1400, c.resolveRegistration({ image_crop: crop }), 0);
  nearPt(legacy, { x: ((0.5 - 0.25) / 0.5) * 1000, y: ((800 / 1400 - 0.5) / 0.25) * 700 });
  const edited = c.editCrop({ image_crop: crop }, [0.3, 0.55, 0.4, 0.2]);
  nearPt(c.rasterToPlan({ x: 1000, y: 800 }, 2000, 1400, c.resolveRegistration(edited), 0), legacy);
  assert.deepEqual(c.visibleRasterWindow([0.25, 0.5, 0.5, 0.25], 2000, 1400), { x: 500, y: 700, width: 1000, height: 350 });
});

test("clip follows the rotated source frame and visibility tests agree", () => {
  const state = c.editCrop({ image_crop: null }, [0.5, 0, 0.5, 1]);
  assert.deepEqual(c.cropLayout(state, 0).clip, { x: 500, y: 0, width: 500, height: 700 });
  assert.equal(c.isInsideCrop({ x: 750, y: 100 }, state, 0), true);
  assert.equal(c.isInsideCrop({ x: 250, y: 100 }, state, 0), false);
  assert.equal(c.isInsideCrop({ x: 250, y: 350 }, state, 180), true);
  assert.equal(c.isInsideCrop({ x: 750, y: 350 }, state, 180), false);
  const poly = c.cropPolygon(state, 180);
  near(poly[0].x, 500); near(poly[1].x, 0);
});

test("invalid crops fall back safely and setCropValue clamps", () => {
  assert.deepEqual(c.normalizeCrop([0.5, 0.5, 0.8, 0.8]), [0, 0, 1, 1]);
  assert.deepEqual(c.resolveRegistration({ image_crop: [0, 0, NaN, 1], image_crop_reference: [0.1, 0.1, 0.5, 0.5] }), [0.1, 0.1, 0.5, 0.5]);
  near(c.setCropValue([0.05, 0.05, 0.9, 0.9], 0, 0.9)[0], 0.1);
  assert.deepEqual(c.setCropValue(null, 2, 0.01), [0, 0, 0.2, 1]);
});

// Pixel-visibility model of the old render: canvas clip applied after rotating the full stretched image.
const legacyVisible = (crop, deg, p) => {
  if (p.x < 0 || p.y < 0 || p.x > 1000 || p.y > 700) return false;
  const a = (-deg * Math.PI) / 180, dx = p.x - 500, dy = p.y - 350;
  const u = { x: 500 + dx * Math.cos(a) - dy * Math.sin(a), y: 350 + dx * Math.sin(a) + dy * Math.cos(a) };
  const r = legacyImage(crop);
  return u.x >= r.x && u.x <= r.x + r.width && u.y >= r.y && u.y <= r.y + r.height;
};
const layoutVisible = (l, deg, p) => {
  if (p.x < 0 || p.y < 0 || p.x > 1000 || p.y > 700) return false;
  const a = (-deg * Math.PI) / 180, dx = p.x - 500, dy = p.y - 350;
  const u = { x: 500 + dx * Math.cos(a) - dy * Math.sin(a), y: 350 + dx * Math.sin(a) + dy * Math.cos(a) };
  const inside = (r) => u.x >= r.x && u.x <= r.x + r.width && u.y >= r.y && u.y <= r.y + r.height;
  return inside(l.image) && (!l.clip || inside(l.clip));
};

test("rotated corners match legacy for legacy data and for crop == registration / full crop", () => {
  const points = [];
  for (let x = 0; x <= 1000; x += 50) for (let y = 0; y <= 700; y += 50) points.push({ x, y });
  for (const crop of [null, [0.1, 0.1, 0.8, 0.8], [0.25, 0.1, 0.5, 0.3]]) {
    for (const deg of [0, 15, 45, 90, 137, 270]) {
      const states = [{ image_crop: crop }, { image_crop: crop, image_crop_reference: crop ?? [0, 0, 1, 1] }];
      for (const state of states) {
        const l = c.cropLayout(state, deg);
        assert.equal(l.clip, null);
        for (const p of points) assert.equal(layoutVisible(l, deg, p), legacyVisible(crop, deg, p), `${JSON.stringify(state)} ${deg} ${p.x},${p.y}`);
      }
    }
  }
  // reset to a full crop after editing keeps the registered image, with no inner clip
  const reset = c.editCrop({ image_crop: [0.1, 0.1, 0.8, 0.8] }, null);
  assert.equal(c.cropLayout(reset, 45).clip, null);
});

test("an actually narrowed crop does clip in the source frame at non-zero rotation", () => {
  const state = c.editCrop({ image_crop: [0.1, 0.1, 0.8, 0.8] }, [0.3, 0.3, 0.4, 0.4]);
  const l = c.cropLayout(state, 45);
  assert.notEqual(l.clip, null);
  assert.equal(layoutVisible(l, 45, { x: 500, y: 350 }), true);
  assert.equal(layoutVisible(l, 45, { x: 50, y: 50 }), false);
});

test("detector registration matches helper mapping for edited crop at rotation", () => {
  // see room-detection test; here: raster mapping is registration-driven
  const reg = [0.1, 0.1, 0.8, 0.8];
  const p = c.rasterToPlan({ x: 600, y: 400 }, 1000, 800, reg, 90);
  nearPt(c.planToImage(p, reg, 90), { x: 0.6, y: 0.5 });
});
