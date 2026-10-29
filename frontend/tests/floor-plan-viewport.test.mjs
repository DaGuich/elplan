import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../src/features/projects/components/floor-plan-viewport.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { attachWheelNavigation, isTrackpadPan, panViewBox, wheelPixels, zoomViewBox } =
  await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);

test("zoom keeps the world point under the pointer when not constrained by an edge", () => {
  const view = { x: 100, y: 70, width: 800, height: 560 };
  const anchor = { x: 0.3, y: 0.6 };
  const zoomed = zoomViewBox(view, 0.5, anchor);
  assert.equal(zoomed.x + zoomed.width * anchor.x, view.x + view.width * anchor.x);
  assert.equal(zoomed.y + zoomed.height * anchor.y, view.y + view.height * anchor.y);
});

test("zoom and pan respect bounds and zoom limits", () => {
  const full = { x: 0, y: 0, width: 1000, height: 700 };
  assert.deepEqual(zoomViewBox(full, 2, { x: 0, y: 0 }), full);
  const min = zoomViewBox(full, 0.01, { x: 1, y: 1 });
  assert.deepEqual(min, { x: 750, y: 525, width: 250, height: 175 });
  assert.deepEqual(panViewBox(min, -1000, 1000), { ...min, x: 0, y: 525 });
  assert.deepEqual(zoomViewBox(min, 0.5, { x: 0.5, y: 0.5 }), min);
});

test("trackpad scrolling pans; mouse wheel and pinch zoom", () => {
  assert.equal(isTrackpadPan({ ctrlKey: false, deltaMode: 0, deltaX: 0, deltaY: 3 }), true);
  assert.equal(isTrackpadPan({ ctrlKey: false, deltaMode: 0, deltaX: 10, deltaY: 80 }), true);
  assert.equal(isTrackpadPan({ ctrlKey: false, deltaMode: 0, deltaX: 0, deltaY: 100 }), false);
  assert.equal(isTrackpadPan({ ctrlKey: false, deltaMode: 1, deltaX: 0, deltaY: 3 }), false);
  assert.equal(isTrackpadPan({ ctrlKey: true, deltaMode: 0, deltaX: 0, deltaY: 3 }), false);
  assert.equal(wheelPixels(3, 1, 600), 48);
  assert.equal(wheelPixels(1, 2, 600), 600);
});

test("wheel listener is non-passive, traps all events, and is removed on cleanup", () => {
  let handler;
  let options;
  let removed;
  const svg = {
    addEventListener(type, listener, opts) { assert.equal(type, "wheel"); handler = listener; options = opts; },
    removeEventListener(type, listener) { assert.equal(type, "wheel"); removed = listener; },
    getScreenCTM() { return null; },
  };
  const cleanup = attachWheelNavigation(svg, () => assert.fail("no transform"));
  let prevented = false;
  let stopped = false;
  handler({ preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.deepEqual(options, { passive: false });
  assert.equal(prevented, true);
  assert.equal(stopped, true);
  cleanup();
  assert.equal(removed, handler);
});

test("wheel zoom uses SVG coordinates, including letterbox offsets", () => {
  let handler;
  let view = { x: 100, y: 70, width: 800, height: 560 };
  const svg = {
    addEventListener(_type, listener) { handler = listener; },
    removeEventListener() {},
    getScreenCTM() { return { inverse: () => ({ a: 2, b: 0, c: 0, d: 2, e: 20, f: -30 }) }; },
    clientWidth: 400,
    clientHeight: 400,
    viewBox: { baseVal: view },
  };
  attachWheelNavigation(svg, (fn) => { view = fn(view); });
  const point = { x: 340, y: 406 };
  handler({ preventDefault() {}, stopPropagation() {}, deltaX: 0, deltaY: -100, deltaMode: 0, ctrlKey: false, clientX: 160, clientY: 218 });
  assert.ok(Math.abs(view.x + view.width * 0.3 - point.x) < 1e-9);
  assert.ok(Math.abs(view.y + view.height * 0.6 - point.y) < 1e-9);
});

test("trackpad wheel pans in both axes without changing zoom", () => {
  let handler;
  let view = { x: 100, y: 70, width: 500, height: 350 };
  const svg = {
    addEventListener(_type, listener) { handler = listener; },
    removeEventListener() {},
    getScreenCTM() { return { inverse: () => ({ a: 2, b: 0, c: 0, d: 2 }) }; },
    clientWidth: 250,
    clientHeight: 175,
  };
  attachWheelNavigation(svg, (fn) => { view = fn(view); });
  handler({ preventDefault() {}, stopPropagation() {}, deltaX: 4, deltaY: -3, deltaMode: 0, ctrlKey: false });
  assert.deepEqual(view, { x: 108, y: 64, width: 500, height: 350 });
});
