import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundled = buildSync({
  entryPoints: [new URL("../src/features/projects/domain/rcd-board.ts", import.meta.url).pathname],
  bundle: true,
  format: "esm",
  write: false,
  logLevel: "silent",
}).outputFiles[0].text;
const { resolveRcdBoard } = await import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);

test("board choice is automatic only when zero or one board exists", () => {
  assert.equal(resolveRcdBoard([], ""), null);
  assert.equal(resolveRcdBoard([{ id: 8 }], ""), 8);
  assert.equal(resolveRcdBoard([{ id: 8 }, { id: 9 }], ""), undefined);
  assert.equal(resolveRcdBoard([{ id: 8 }, { id: 9 }], "10"), undefined);
  assert.equal(resolveRcdBoard([{ id: 8 }, { id: 9 }], "9"), 9);
});
