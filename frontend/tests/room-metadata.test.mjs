import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const code = buildSync({
  entryPoints: [new URL("../src/features/projects/domain/room-metadata.ts", import.meta.url).pathname],
  bundle: true, format: "esm", write: false, logLevel: "silent",
}).outputFiles[0].text;
const m = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

test("normalizes blank optional fields to null and trims", () => {
  assert.deepEqual(m.normalizeRoomMetadata({ name: " Bad ", room_type: "  ", installation_standard: " RAL-RG 678 " }),
    { name: "Bad", room_type: null, installation_standard: "RAL-RG 678" });
});
test("validates required name and max lengths", () => {
  assert.deepEqual(m.validateRoomMetadata({ name: "A" }), {});
  assert.equal(m.validateRoomMetadata({ name: " " }).name, "required");
  assert.equal(m.validateRoomMetadata({ name: "x".repeat(121) }).name, "too_long");
  assert.equal(m.validateRoomMetadata({ name: "A", room_type: "x".repeat(81) }).room_type, "too_long");
});
test("equality ignores whitespace and null/empty differences", () => {
  assert.ok(m.isRoomMetadataEqual({ name: "A", room_type: "" }, { name: "A ", room_type: null }));
  assert.ok(!m.isRoomMetadataEqual({ name: "A", room_type: "Bad" }, { name: "A" }));
});
