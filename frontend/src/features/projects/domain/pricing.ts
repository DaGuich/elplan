import type { PriceEntry, PricingTemplate } from "../api";

function norm(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function key(name: string, unit: string) {
  return `${norm(name)}\u0000${norm(unit)}`;
}

// Fills only auto-generated rows still at 0 (manual rows may be intentionally free).
// Requires an exact normalized name and unit match; ambiguous duplicate templates are skipped.
export function applyPricingTemplates(prices: PriceEntry[], templates: PricingTemplate[]): { prices: PriceEntry[]; applied: number } {
  const byKey = new Map<string, PricingTemplate | null>();
  for (const template of templates) {
    const k = key(template.name, template.unit);
    byKey.set(k, byKey.has(k) ? null : template);
  }
  let applied = 0;
  const next = prices.map((item) => {
    if (item.source_id === null || item.unit_price !== 0) return item;
    const template = byKey.get(key(item.name, item.unit));
    if (!template || !(template.unit_price > 0)) return item;
    applied += 1;
    return { ...item, unit_price: template.unit_price };
  });
  return { prices: next, applied };
}
