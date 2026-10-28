import { FormEvent, useMemo, useState } from "react";

import {
  CabinetConfiguration,
  CabinetModule,
  CabinetRail,
  CustomComponent,
  FloorPlanData,
} from "../api";

type Props = { data: FloorPlanData; onChange: (patch: Partial<FloorPlanData>) => void };
type CatalogItem = { id: string; name: string; width: number; color: string };

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `module-${Date.now()}-${Math.random()}`;
}

function defaultRails(rows: number, columns: number): CabinetRail[] {
  return Array.from({ length: rows }, (_, index) => ({
    id: `rail-${index + 1}`,
    name: `Row ${index + 1}`,
    modules: columns,
    height_mm: 0,
    spacing_mm: 125,
  }));
}

export function CabinetEditor({ data, onChange }: Props) {
  const [customName, setCustomName] = useState("");
  const [customWidth, setCustomWidth] = useState(1);
  const [draggedModuleId, setDraggedModuleId] = useState<string>();
  const cabinet = data.cabinet;
  const rails = cabinet.rails.length ? cabinet.rails : defaultRails(cabinet.rows, cabinet.columns);

  const catalog = useMemo<CatalogItem[]>(() => [
    ...data.rcds.map((item) => ({ id: item.id, name: item.name, width: item.poles === 4 ? 4 : 2, color: "#b9d8ce" })),
    ...data.circuits.map((item) => ({ id: item.id, name: item.name, width: item.poles, color: "#dce8e4" })),
    ...data.smart_devices.filter((item) => item.te_width > 0).map((item) => ({ id: item.id, name: item.name, width: item.te_width, color: item.color })),
    ...data.electrical_components.map((item) => ({ id: item.id, name: item.name, width: item.te_width, color: item.color })),
    ...data.custom_components.map((item) => ({ id: item.id, name: item.name, width: item.te_width, color: item.color })),
  ], [data.circuits, data.custom_components, data.electrical_components, data.rcds, data.smart_devices]);

  function updateCabinet(patch: Partial<CabinetConfiguration>) {
    onChange({ cabinet: { ...cabinet, ...patch, rails: patch.rails ?? rails } });
  }

  function firstOpenPosition(rail: CabinetRail, width: number, modules: CabinetModule[]) {
    for (let start = 0; start + width <= rail.modules; start += 1) {
      const collides = modules.some(
        (module) =>
          module.rail_id === rail.id &&
          start < module.position + module.te_width &&
          start + width > module.position
      );
      if (!collides) return start;
    }
    return -1;
  }

  function addCatalogItem(item: CatalogItem, railId = rails[0]?.id) {
    const rail = rails.find((row) => row.id === railId);
    if (!rail) return;
    const position = firstOpenPosition(rail, item.width, cabinet.modules);
    if (position < 0) return;
    const module: CabinetModule = {
      id: makeId(),
      component_id: item.id,
      name: item.name,
      rail_id: rail.id,
      position,
      te_width: item.width,
      color: item.color,
    };
    updateCabinet({ modules: [...cabinet.modules, module] });
  }

  function arrangeAutomatically() {
    const placements: CabinetModule[] = [];
    for (const [index, item] of catalog.entries()) {
      const rail = rails[Math.min(Math.floor(index / 10), rails.length - 1)];
      if (!rail) continue;
      const position = firstOpenPosition(rail, item.width, placements);
      if (position >= 0) {
        placements.push({
          id: makeId(),
          component_id: item.id,
          name: item.name,
          rail_id: rail.id,
          position,
          te_width: item.width,
          color: item.color,
        });
      }
    }
    updateCabinet({ modules: placements });
  }

  function moveModule(moduleId: string, railId: string, rawPosition: number) {
    const module = cabinet.modules.find((item) => item.id === moduleId);
    const rail = rails.find((item) => item.id === railId);
    if (!module || !rail) return;
    const position = Math.max(0, Math.min(rail.modules - Math.ceil(module.te_width), Math.round(rawPosition)));
    const available = firstOpenPosition(
      { ...rail, id: `move-check-${rail.id}` },
      module.te_width,
      cabinet.modules
        .filter((item) => item.id !== moduleId)
        .map((item) => ({ ...item, rail_id: item.rail_id === rail.id ? `move-check-${rail.id}` : item.rail_id }))
    );
    if (available < 0) return;
    const collision = cabinet.modules.some(
      (item) =>
        item.id !== moduleId &&
        item.rail_id === rail.id &&
        position < item.position + item.te_width &&
        position + module.te_width > item.position
    );
    if (collision) return;
    updateCabinet({
      modules: cabinet.modules.map((item) => item.id === moduleId ? { ...item, rail_id: rail.id, position } : item),
    });
  }

  function resizeRows(rows: number) {
    const nextRails = defaultRails(rows, cabinet.columns).map((rail) => {
      const existing = rails.find((item) => item.id === rail.id);
      return existing ? { ...existing, modules: cabinet.columns } : rail;
    });
    const validIds = new Set(nextRails.map((rail) => rail.id));
    updateCabinet({
      rows,
      rails: nextRails,
      modules: cabinet.modules.filter((module) => validIds.has(module.rail_id)),
    });
  }

  function resizeColumns(columns: number) {
    const nextRails = rails.map((rail) => ({ ...rail, modules: columns }));
    updateCabinet({
      columns,
      rails: nextRails,
      modules: cabinet.modules.filter((module) => module.position + module.te_width <= columns),
    });
  }

  function addCustomComponent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const component: CustomComponent = {
      id: makeId(),
      name: customName.trim(),
      kind: "custom_reg",
      te_width: customWidth,
      channel_kinds: [],
      color: "#8797bd",
      favorite: false,
    };
    onChange({ custom_components: [...data.custom_components, component] });
    setCustomName("");
  }

  const usedByRail = (rail: CabinetRail) =>
    cabinet.modules
      .filter((module) => module.rail_id === rail.id)
      .reduce((sum, module) => sum + module.te_width, 0);
  const terminalWidth = data.terminal_strips.reduce(
    (sum, strip) =>
      sum +
      strip.circuit_ids.length * strip.terminals_per_circuit * strip.terminal_width_mm +
      (strip.end_brackets + strip.separators) * strip.terminal_width_mm,
    0
  );
  const automaticTerminalWidth = data.circuits.length * 3 * 5.2 + data.terminal_strips.length * 2 * 5.2;

  return (
    <div className="cabinet-layout">
      <aside className="cabinet-controls">
        <p className="eyebrow">ENCLOSURE</p>
        <label className="field-label">Board name<input value={cabinet.name} onChange={(event) => updateCabinet({ name: event.target.value })} /></label>
        <label className="field-label">Manufacturer<input value={cabinet.manufacturer ?? ""} placeholder="Manufacturer" onChange={(event) => updateCabinet({ manufacturer: event.target.value || null })} /></label>
        <label className="field-label">Model<input value={cabinet.model ?? ""} placeholder="Enclosure model" onChange={(event) => updateCabinet({ model: event.target.value || null })} /></label>
        <label className="field-label">DIN rails / rows<input type="number" min={1} max={24} value={cabinet.rows} onChange={(event) => resizeRows(Math.max(1, Number(event.target.value)))} /></label>
        <label className="field-label">TE per rail<input type="number" min={1} max={72} value={cabinet.columns} onChange={(event) => resizeColumns(Math.max(1, Number(event.target.value)))} /></label>
        <label className="field-label">Drawing page<select value={cabinet.page_size} onChange={(event) => updateCabinet({ page_size: event.target.value as CabinetConfiguration["page_size"] })}><option>A4</option><option>A3</option><option>A2</option><option value="custom">Custom</option></select></label>
        <label className="field-label">Spare TE per rail<input type="number" min={0} max={72} value={cabinet.spare_modules_per_rail} onChange={(event) => updateCabinet({ spare_modules_per_rail: Number(event.target.value) })} /></label>
        <label className="field-label">Mounting notes<textarea rows={3} value={cabinet.mounting_notes} onChange={(event) => updateCabinet({ mounting_notes: event.target.value, rows: cabinet.rows, columns: cabinet.columns, rails })} /></label>
        <button type="button" className="button-primary" onClick={arrangeAutomatically}>Auto-arrange devices</button>
        <div className="sidebar-divider" />
        <p className="eyebrow">COMPONENT LIBRARY · CUSTOM REG</p>
        {catalog.map((item) => (
          <div className="catalog-item" key={`${item.id}-${item.name}`}>
            <span className="catalog-chip" style={{ backgroundColor: item.color }}>{item.width} TE</span><span>{item.name}</span>
            <button type="button" className="icon-button" aria-label={`Add ${item.name} to DIN rail`} onClick={() => addCatalogItem(item)}>＋</button>
          </div>
        ))}
        <form className="custom-component-form" onSubmit={addCustomComponent}>
          <label className="field-label">Custom module name<input required value={customName} onChange={(event) => setCustomName(event.target.value)} /></label>
          <label className="field-label">Width (TE)<input type="number" min="0.5" max="72" step="0.5" value={customWidth} onChange={(event) => setCustomWidth(Number(event.target.value))} /></label>
          <button type="submit" className="button-secondary">Save custom REG module</button>
        </form>
      </aside>
      <div className="cabinet-canvas-column">
        <header className="cabinet-summary">
          <div><p className="eyebrow">ASSEMBLY PLAN</p><h4>{cabinet.name}</h4></div>
          <span>{cabinet.rows} rails · {cabinet.columns} TE each</span>
        </header>
        <div className="cabinet-canvas">
          {rails.map((rail) => {
            const modules = cabinet.modules.filter((module) => module.rail_id === rail.id);
            const used = usedByRail(rail);
            return (
              <section key={rail.id} className="rail-section">
                <header className="rail-heading">
                  <strong>{rail.name}</strong>
                  <span>{used.toFixed(1)} / {rail.modules} TE used · {Math.max(0, rail.modules - used).toFixed(1)} free · {Math.min(cabinet.spare_modules_per_rail, Math.max(0, rail.modules - used))} TE spare target</span>
                </header>
                <div className="din-rail" style={{ gridTemplateColumns: `repeat(${rail.modules}, minmax(13px, 1fr))` }}>
                  {Array.from({ length: rail.modules }, (_, index) => (
                    <button
                      type="button"
                      key={index}
                      className="te-slot"
                      aria-label={`${rail.name} position ${index + 1}`}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => { event.preventDefault(); if (draggedModuleId) moveModule(draggedModuleId, rail.id, index); }}
                    />
                  ))}
                  {modules.map((module) => (
                    <div
                      key={module.id}
                      className="din-module"
                      draggable
                      onDragStart={() => setDraggedModuleId(module.id)}
                      onDragEnd={() => setDraggedModuleId(undefined)}
                      style={{
                        gridColumn: `${module.position + 1} / span ${Math.ceil(module.te_width)}`,
                        backgroundColor: module.color,
                      }}
                    >
                      <strong>{module.name}</strong><small>{module.te_width} TE</small>
                      <button type="button" aria-label={`Remove ${module.name} from rail`} onClick={() => updateCabinet({ modules: cabinet.modules.filter((item) => item.id !== module.id) })}>×</button>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
        <div className="terminal-sizing">
          <strong>Terminal strip sizing</strong>
          <span>{data.terminal_strips.length ? `${terminalWidth.toFixed(1)} mm configured` : `${automaticTerminalWidth.toFixed(1)} mm estimated`}</span>
          <span>3 terminals per outgoing circuit · 5.2 mm per terminal · end brackets included</span>
        </div>
      </div>
    </div>
  );
}
