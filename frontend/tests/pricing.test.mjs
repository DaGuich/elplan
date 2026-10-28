import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundled = buildSync({
  entryPoints: [new URL("../src/features/projects/domain/pricing.ts", import.meta.url).pathname],
  bundle: true, format: "esm", write: false, logLevel: "silent",
}).outputFiles[0].text;
const { applyPricingTemplates } = await import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);

const row = (id, name, unit_price, source_id = `placement:${id}`, unit = "piece") => ({ id, name, category: "device", quantity: 2, unit, unit_price, source_id });
const tpl = (name, unit_price, unit = "piece") => ({ name, unit, unit_price });

test("fills unpriced generated rows by normalized name and unit", () => {
  const result = applyPricingTemplates(
    [row("a", "Socket", 0), row("b", " socket ", 5), row("c", "Switch", 0)],
    [tpl("  SOCKET ", 3.5, " Piece ")],
  );
  assert.equal(result.applied, 1);
  assert.deepEqual(result.prices.map((item) => item.unit_price), [3.5, 5, 0]);
  assert.equal(result.prices[0].quantity, 2);
});

test("requires matching unit", () => {
  assert.equal(applyPricingTemplates([row("a", "Cable", 0, "x", "m")], [tpl("Cable", 1, "piece")]).applied, 0);
});

test("skips ambiguous duplicate templates", () => {
  const result = applyPricingTemplates([row("a", "Socket", 0)], [tpl("Socket", 3), tpl("socket", 4)]);
  assert.equal(result.applied, 0);
  assert.equal(result.prices[0].unit_price, 0);
});

test("never touches manual entries, even at zero", () => {
  const result = applyPricingTemplates([row("a", "Socket", 0, null)], [tpl("Socket", 3)]);
  assert.equal(result.applied, 0);
  assert.equal(result.prices[0].unit_price, 0);
});

test("ignores zero-priced templates and empty input", () => {
  assert.equal(applyPricingTemplates([row("a", "Socket", 0)], [tpl("Socket", 0)]).applied, 0);
  assert.equal(applyPricingTemplates([], []).applied, 0);
});
