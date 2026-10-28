import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundled = buildSync({
  entryPoints: [new URL("../src/features/projects/domain/board-management.ts", import.meta.url).pathname],
  bundle: true,
  format: "esm",
  write: false,
  logLevel: "silent",
}).outputFiles[0].text;
const boardManagement = await import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);

const board = {
  id: 11,
  project_id: 3,
  name: "  Main board ",
  kind: "main",
  floor_id: 27,
  data: { custom: true },
};

test("board form maps optional floors to the API's nullable floor ID", () => {
  assert.deepEqual(boardManagement.boardFormValues(board), {
    name: "  Main board ",
    kind: "main",
    floorId: "27",
  });
  assert.deepEqual(boardManagement.boardFormValues(), { name: "", kind: "sub", floorId: "" });
  assert.equal(boardManagement.boardInput({ name: "Board", kind: "sub", floorId: "" }).floor_id, null);
});

test("board edits trim names and preserve existing topology data", () => {
  assert.deepEqual(
    boardManagement.boardInput({ name: "  Updated board  ", kind: "sub", floorId: "27" }, board),
    { name: "Updated board", kind: "sub", floor_id: 27, data: { custom: true } },
  );
});
