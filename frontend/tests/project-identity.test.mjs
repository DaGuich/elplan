import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundled = buildSync({
  entryPoints: [new URL("../src/features/projects/domain/project-identity.ts", import.meta.url).pathname],
  bundle: true, format: "esm", write: false, logLevel: "silent",
}).outputFiles[0].text;
const { resolveProjectIdentity } = await import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);

test("project values win over legacy floor values", () => {
  const r = resolveProjectIdentity({ client_name: " Erika ", project_number: "P-1" }, { customer_name: "Old", project_number: "O-1" });
  assert.deepEqual(r, { customer: "Erika", number: "P-1", customerLegacy: false, numberLegacy: false });
});

test("legacy values are an explicit fallback per field", () => {
  const r = resolveProjectIdentity({ client_name: null, project_number: "P-1" }, { customer_name: "Old", project_number: "O-1" });
  assert.deepEqual(r, { customer: "Old", number: "P-1", customerLegacy: true, numberLegacy: false });
});

test("handles missing details and legacy data", () => {
  assert.deepEqual(resolveProjectIdentity(undefined, {}), { customer: "", number: "", customerLegacy: false, numberLegacy: false });
});
