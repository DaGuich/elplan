import { ChangeEvent, FormEvent, useMemo, useState } from "react";

import {
  ElectricalCircuit,
  FloorPlanData,
  PriceEntry,
  ProjectAnnotation,
  ResidualCurrentDevice,
  TestMeasurement,
} from "../api";

type Props = {
  data: FloorPlanData;
  floorName: string;
  projectName: string;
  active?: boolean;
  onChange: (patch: Partial<FloorPlanData>) => void;
};

const measurementKinds: TestMeasurement["kind"][] = [
  "continuity", "insulation", "loop_impedance", "rcd_trip_time", "rcd_trip_current", "voltage", "polarity", "earth_resistance", "other",
];

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `record-${Date.now()}-${Math.random()}`;
}

function makeBom(data: FloorPlanData): PriceEntry[] {
  const rows: PriceEntry[] = [];
  const add = (name: string, category: PriceEntry["category"], quantity: number, unit: string, sourceId: string) => {
    if (quantity <= 0) return;
    const existing = data.prices.find((item) => item.source_id === sourceId);
    rows.push({
      id: existing?.id ?? makeId(),
      name,
      category,
      quantity,
      unit,
      unit_price: existing?.unit_price ?? 0,
      source_id: sourceId,
    });
  };
  const kindLabels = new Map<string, string>();
  for (const item of data.placements) kindLabels.set(item.kind, item.label);
  for (const kind of new Set(data.placements.map((item) => item.kind))) {
    add(kindLabels.get(kind) ?? kind, "device", data.placements.filter((item) => item.kind === kind).length, "piece", `placement:${kind}`);
  }
  data.rcds.forEach((item) => add(item.name, "device", 1, "piece", `rcd:${item.id}`));
  data.circuits.forEach((item) => add(item.name, "device", 1, "piece", `circuit:${item.id}`));
  data.smart_devices.forEach((item) => add(item.name, "device", 1, "piece", `smart:${item.id}`));
  data.electrical_components.forEach((item) => add(item.name, "device", 1, "piece", `component:${item.id}`));
  if (data.circuits.length) add("Installation labor", "labor", data.circuits.length, "circuit", "labor:installation");
  return rows;
}

function circuitNumber(circuit: ElectricalCircuit, rcds: ResidualCurrentDevice[], circuits: ElectricalCircuit[]) {
  const rcdIndex = rcds.findIndex((rcd) => rcd.id === circuit.rcd_id) + 1;
  const circuitIndex = circuits.filter((item) => item.rcd_id === circuit.rcd_id).findIndex((item) => item.id === circuit.id) + 1;
  return `F${rcdIndex}.${circuitIndex}`;
}

function csvCell(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

export function DocumentationPanel({ data, floorName, projectName, active = true, onChange }: Props) {
  const [importMessage, setImportMessage] = useState("");
  const annotation = data.annotation;
  const total = data.prices.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
  const passed = data.measurements.filter((item) => item.passed).length;

  const circuitTotals = useMemo(() => {
    const byRcd = new Map<string, number>();
    for (const circuit of data.circuits) {
      byRcd.set(circuit.rcd_id, (byRcd.get(circuit.rcd_id) ?? 0) + 1);
    }
    return byRcd;
  }, [data.circuits]);

  function updateAnnotation(patch: Partial<ProjectAnnotation>) {
    onChange({ annotation: { ...annotation, ...patch } });
  }

  function addMeasurement() {
    const record: TestMeasurement = {
      id: makeId(),
      circuit_id: data.circuits[0]?.id ?? null,
      kind: "continuity",
      measured_value: 0,
      unit: "Ω",
      limit_value: null,
      passed: true,
      measured_at: new Date().toISOString().slice(0, 10),
      notes: "",
    };
    onChange({ measurements: [...data.measurements, record] });
  }

  function importProtocol(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 2_000_000) {
      setImportMessage("Test protocol CSV must be 2 MB or smaller.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        setImportMessage("Could not read the selected protocol.");
        return;
      }
      const lines = reader.result.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) {
        setImportMessage("CSV must include a header and at least one test row.");
        return;
      }
      const delimiter = lines[0].includes(";") ? ";" : ",";
      const headers = lines[0].split(delimiter).map((value) => value.trim().toLowerCase().replace(/^"|"$/g, ""));
      const column = (name: string, fallback: number) => {
        const index = headers.findIndex((value) => value === name || value.includes(name));
        return index < 0 ? fallback : index;
      };
      const parseCell = (line: string, index: number) => (line.split(delimiter)[index] ?? "").trim().replace(/^"|"$/g, "");
      const imported = lines.slice(1).map((line): TestMeasurement | null => {
        const cells = line.split(delimiter).map((value) => value.trim().replace(/^"|"$/g, ""));
        const measured = Number(cells[column("value", 2)]);
        if (!Number.isFinite(measured)) return null;
        const circuitText = cells[column("circuit", 0)].toLowerCase();
        const circuit = data.circuits.find((item) => item.name.toLowerCase() === circuitText || circuitNumber(item, data.rcds, data.circuits).toLowerCase() === circuitText);
        const kindText = cells[column("test", 1)].toLowerCase().replace(/[ -]/g, "_");
        const kind = measurementKinds.find((item) => kindText.includes(item)) ?? "other";
        const limitCell = cells[column("limit", 4)];
        const result = cells[column("result", 5)].toLowerCase();
        return {
          id: makeId(),
          circuit_id: circuit?.id ?? null,
          kind,
          measured_value: measured,
          unit: cells[column("unit", 3)] || "—",
          limit_value: limitCell && Number.isFinite(Number(limitCell)) ? Number(limitCell) : null,
          passed: !["fail", "failed", "false", "no", "nicht bestanden"].includes(result),
          measured_at: cells[column("date", 6)] || null,
          notes: parseCell(line, column("notes", 7)),
        };
      }).filter((item): item is TestMeasurement => item !== null);
      if (!imported.length) {
        setImportMessage("No valid measurement rows were found.");
        return;
      }
      onChange({ measurements: [...data.measurements, ...imported] });
      setImportMessage(`${imported.length} test measurements imported.`);
    };
    reader.onerror = () => setImportMessage("Could not read the selected protocol.");
    reader.readAsText(file);
  }

  function addManualPrice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const entry: PriceEntry = {
      id: makeId(),
      name: String(form.get("name") ?? "").trim(),
      category: String(form.get("category") ?? "other") as PriceEntry["category"],
      quantity: Number(form.get("quantity")),
      unit: String(form.get("unit") ?? "piece"),
      unit_price: Number(form.get("price")),
      source_id: null,
    };
    if (!entry.name || entry.quantity <= 0 || entry.unit_price < 0) return;
    onChange({ prices: [...data.prices, entry] });
    event.currentTarget.reset();
  }

  function exportBom() {
    const rows = [
      ["Category", "Description", "Quantity", "Unit", "Unit price", "Total"],
      ...data.prices.map((item) => [item.category, item.name, item.quantity, item.unit, item.unit_price.toFixed(2), (item.quantity * item.unit_price).toFixed(2)]),
      ["", "Grand total", "", "", "", total.toFixed(2)],
    ];
    const csv = rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-bill-of-materials.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function refreshBom() {
    const autoItems = makeBom(data);
    const manualItems = data.prices.filter((item) => item.source_id === null);
    onChange({ prices: [...autoItems, ...manualItems] });
  }

  const terminalRows = data.terminal_strips.length
    ? data.terminal_strips
    : data.rcds.map((rcd, index) => ({
        id: `auto-${rcd.id}`,
        name: `X${index + 1}`,
        kind: "external" as const,
        circuit_ids: data.circuits.filter((circuit) => circuit.rcd_id === rcd.id).map((circuit) => circuit.id),
        terminals_per_circuit: 3,
        terminal_width_mm: 5.2,
        end_brackets: 2,
        separators: 0,
      }));

  return (
    <div className={active ? "documentation-panel active" : "documentation-panel inactive"}>
      <header className="circuits-intro">
        <div><p className="eyebrow">PROJECT DOCUMENTATION</p><h4>Handbook, pricing and verification records</h4><p>Project cover, legends, test values, terminal plans, and materials/pricing are part of the printable handover.</p></div>
        <div className="workspace-actions"><button type="button" className="button-secondary" onClick={exportBom}>Export BOM CSV</button><button type="button" className="button-primary" onClick={() => window.print()}>Print project handbook / PDF</button></div>
      </header>
      <div className="documentation-grid">
        <section className="documentation-card">
          <h5>Title block &amp; presentation</h5>
          <label>Document title<input value={annotation.title} onChange={(event) => updateAnnotation({ title: event.target.value })} /></label>
          <label>Customer / client<input value={annotation.customer_name} onChange={(event) => updateAnnotation({ customer_name: event.target.value })} /></label>
          <label>Project number<input value={annotation.project_number} onChange={(event) => updateAnnotation({ project_number: event.target.value })} /></label>
          <label>Presentation mode<select value={annotation.presentation_mode} onChange={(event) => updateAnnotation({ presentation_mode: event.target.value as ProjectAnnotation["presentation_mode"] })}><option value="planning">Planning / technical</option><option value="client">Client consultation</option></select></label>
          <label>Legend<textarea rows={4} value={annotation.legend} onChange={(event) => updateAnnotation({ legend: event.target.value })} /></label>
          <label>Project notes<textarea rows={5} value={annotation.notes} onChange={(event) => updateAnnotation({ notes: event.target.value })} /></label>
        </section>
        <section className="documentation-card">
          <div className="card-title-row"><h5>Verification / test protocol</h5><label className="button-secondary import-file-button">Import protocol CSV<input type="file" accept=".csv,text/csv" onChange={importProtocol} /></label></div>
          <p className="field-hint">CSV columns: circuit, test, value, unit, limit, result, date, notes. Compatible measurement records can be imported from test systems.</p>
          {importMessage && <p className="editor-status">{importMessage}</p>}
          <div className="test-summary"><strong>{passed} passed</strong><span>{data.measurements.length - passed} review</span><span>{data.measurements.length} total records</span></div>
          <div className="measurement-list">
            {data.measurements.map((item) => (
              <article className={item.passed ? "measurement-row passed" : "measurement-row failed"} key={item.id}>
                <select aria-label="Measurement type" value={item.kind} onChange={(event) => onChange({ measurements: data.measurements.map((row) => row.id === item.id ? { ...row, kind: event.target.value as TestMeasurement["kind"] } : row) })}>{measurementKinds.map((kind) => <option key={kind}>{kind}</option>)}</select>
                <select aria-label="Measurement circuit" value={item.circuit_id ?? ""} onChange={(event) => onChange({ measurements: data.measurements.map((row) => row.id === item.id ? { ...row, circuit_id: event.target.value || null } : row) })}><option value="">General</option>{data.circuits.map((circuit) => <option key={circuit.id} value={circuit.id}>{circuit.name}</option>)}</select>
                <input aria-label="Measured value" type="number" step="any" value={item.measured_value} onChange={(event) => onChange({ measurements: data.measurements.map((row) => row.id === item.id ? { ...row, measured_value: Number(event.target.value) } : row) })} />
                <input aria-label="Unit" value={item.unit} onChange={(event) => onChange({ measurements: data.measurements.map((row) => row.id === item.id ? { ...row, unit: event.target.value } : row) })} />
                <input aria-label="Limit value" placeholder="Limit" type="number" step="any" value={item.limit_value ?? ""} onChange={(event) => onChange({ measurements: data.measurements.map((row) => row.id === item.id ? { ...row, limit_value: event.target.value ? Number(event.target.value) : null } : row) })} />
                <select aria-label="Measurement result" value={item.passed ? "passed" : "review"} onChange={(event) => onChange({ measurements: data.measurements.map((row) => row.id === item.id ? { ...row, passed: event.target.value === "passed" } : row) })}><option value="passed">Pass</option><option value="review">Review</option></select>
                <button className="icon-button" aria-label="Remove measurement" type="button" onClick={() => onChange({ measurements: data.measurements.filter((row) => row.id !== item.id) })}>×</button>
              </article>
            ))}
          </div>
          <button type="button" className="text-button" onClick={addMeasurement}>＋ Add measurement</button>
        </section>
      </div>
      <section className="documentation-card">
        <div className="card-title-row"><h5>Price template &amp; quantity take-off</h5><button type="button" className="button-secondary" onClick={refreshBom}>Refresh quantities from plan</button></div>
        <p className="field-hint">Enter unit prices for devices, installation labor, and cabling. Quantities are counted from the plan and circuit schedule.</p>
        <div className="bom-table-wrap"><table className="bom-table"><thead><tr><th>Category</th><th>Description</th><th>Quantity</th><th>Unit</th><th>Unit price</th><th>Line total</th><th /></tr></thead><tbody>
          {data.prices.map((item) => <tr key={item.id}>
            <td><select value={item.category} onChange={(event) => onChange({ prices: data.prices.map((row) => row.id === item.id ? { ...row, category: event.target.value as PriceEntry["category"] } : row) })}><option value="device">Device</option><option value="labor">Labor</option><option value="cable">Cable</option><option value="other">Other</option></select></td>
            <td><input value={item.name} onChange={(event) => onChange({ prices: data.prices.map((row) => row.id === item.id ? { ...row, name: event.target.value } : row) })} /></td>
            <td><input type="number" min="0" step="any" value={item.quantity} onChange={(event) => onChange({ prices: data.prices.map((row) => row.id === item.id ? { ...row, quantity: Number(event.target.value) } : row) })} /></td>
            <td><input value={item.unit} onChange={(event) => onChange({ prices: data.prices.map((row) => row.id === item.id ? { ...row, unit: event.target.value } : row) })} /></td>
            <td><input type="number" min="0" step="0.01" value={item.unit_price} onChange={(event) => onChange({ prices: data.prices.map((row) => row.id === item.id ? { ...row, unit_price: Number(event.target.value) } : row) })} /></td>
            <td>{(item.quantity * item.unit_price).toFixed(2)}</td>
            <td><button className="icon-button" aria-label={`Remove ${item.name}`} type="button" onClick={() => onChange({ prices: data.prices.filter((row) => row.id !== item.id) })}>×</button></td>
          </tr>)}
          <tr className="bom-total"><td colSpan={5}>Project total</td><td>{total.toFixed(2)}</td><td /></tr>
        </tbody></table></div>
        <form className="manual-price-form" onSubmit={addManualPrice}>
          <input name="name" required placeholder="Custom item or cabling" />
          <select name="category"><option value="device">Device</option><option value="labor">Labor</option><option value="cable">Cable</option><option value="other">Other</option></select>
          <input name="quantity" type="number" min="0.01" step="any" defaultValue="1" />
          <input name="unit" defaultValue="piece" />
          <input name="price" type="number" min="0" step="0.01" defaultValue="0" />
          <button type="submit" className="button-secondary">＋ Add price item</button>
        </form>
      </section>
      <section className="documentation-card">
        <h5>Terminal plan &amp; calculated rail widths</h5>
        {terminalRows.length === 0 && <p className="empty-panel">Add circuits and their terminal groups appear here automatically.</p>}
        <div className="terminal-plan-list">
          {terminalRows.map((strip) => {
            const width = (strip.circuit_ids.length * strip.terminals_per_circuit + strip.end_brackets + strip.separators) * strip.terminal_width_mm;
            return <article className="terminal-plan-row" key={strip.id}><strong>{strip.name}</strong><span>{strip.kind}</span><span>{strip.circuit_ids.length * strip.terminals_per_circuit} terminals</span><span>{width.toFixed(1)} mm</span><span>{strip.terminal_width_mm} mm / terminal</span></article>;
          })}
        </div>
      </section>
      <div className="print-handbook">
        <header className="handbook-cover"><p>ELPLAN · ELECTRICAL PLANNING</p><h1>{annotation.title || projectName}</h1><h2>{floorName}</h2><p>{annotation.customer_name} {annotation.project_number && `· ${annotation.project_number}`}</p></header>
        {annotation.notes && <section><h2>Project notes</h2><p>{annotation.notes}</p></section>}
        <section><h2>Floor plan &amp; installation points</h2><svg viewBox="0 0 1000 700" className="handbook-plan">{data.background_image && <image href={data.background_image} width="1000" height="700" preserveAspectRatio="xMidYMid meet" opacity={data.background_opacity} />}{data.rooms.map((room) => <g key={room.id}><rect x={room.x} y={room.y} width={room.width} height={room.height} fill={room.color} fillOpacity=".45" stroke="#68877f" strokeWidth="2" /><text x={room.x + 10} y={room.y + 22}>{room.name}</text></g>)}{data.placements.map((item) => <g key={item.id} transform={`translate(${item.x},${item.y})`}><circle r="13" fill="#fff" stroke={item.color} strokeWidth="2" /><text textAnchor="middle" dominantBaseline="central" fontSize="8">{item.element_id || item.kind.slice(0, 3).toUpperCase()}</text><text y="25" textAnchor="middle" fontSize="9">{item.label}</text></g>)}</svg><p>{data.rooms.length} rooms · {data.placements.length} installation points · scale {data.scale_m_per_100_units ?? "not calibrated"} m / 100 units</p></section>
        <section><h2>Circuits &amp; protection</h2>{data.rcds.map((rcd, index) => <div key={rcd.id}><h3>F{index + 1} · {rcd.name} · Type {rcd.type} · {rcd.rated_current_ma} mA</h3><table className="handbook-table"><thead><tr><th>Ref.</th><th>Circuit</th><th>MCB</th><th>Supply</th><th>Cable</th><th>Loads</th></tr></thead><tbody>{data.circuits.filter((circuit) => circuit.rcd_id === rcd.id).map((circuit) => <tr key={circuit.id}><td>{circuitNumber(circuit, data.rcds, data.circuits)}</td><td>{circuit.name}</td><td>{circuit.poles}P {circuit.breaker_type}{circuit.rated_current_a}</td><td>{circuit.supply}</td><td>{circuit.cable}</td><td>{circuit.loads.map((loadId) => data.placements.find((item) => item.id === loadId)?.label).filter(Boolean).join(", ")}</td></tr>)}</tbody></table><p>{circuitTotals.get(rcd.id) ?? 0} circuits · X{index + 1} terminal group</p></div>)}</section>
        <section><h2>Cabinet assembly plan</h2><p>{data.cabinet.name} · {data.cabinet.manufacturer ?? ""} {data.cabinet.model ?? ""} · {data.cabinet.rows} rows × {data.cabinet.columns} TE</p>{data.cabinet.rails.map((rail) => <p key={rail.id}><strong>{rail.name}:</strong> {data.cabinet.modules.filter((module) => module.rail_id === rail.id).sort((a, b) => a.position - b.position).map((module) => `${module.name} (${module.te_width} TE, position ${module.position + 1})`).join(" · ") || "spare space"}</p>)}{data.cabinet.mounting_notes && <p>{data.cabinet.mounting_notes}</p>}</section>
        <section><h2>Smart building &amp; bus devices</h2>{data.smart_devices.map((device) => <article key={device.id}><h3>{device.system.toUpperCase()} · {device.name}</h3><p>{device.model} {device.line} {device.address}</p>{device.channels.map((channel) => <p key={channel.id}>{channel.name} ({channel.kind}, {channel.address}) → {channel.load_ids.map((id) => data.placements.find((item) => item.id === id)?.label).filter(Boolean).join(", ")}</p>)}</article>)}</section>
        <section><h2>Terminal plan &amp; bill of materials</h2>{terminalRows.map((strip) => <p key={strip.id}>{strip.name}: {strip.circuit_ids.length * strip.terminals_per_circuit} terminals, {((strip.circuit_ids.length * strip.terminals_per_circuit + strip.end_brackets + strip.separators) * strip.terminal_width_mm).toFixed(1)} mm</p>)}<table className="handbook-table"><thead><tr><th>Item</th><th>Quantity</th><th>Unit price</th><th>Total</th></tr></thead><tbody>{data.prices.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.quantity} {item.unit}</td><td>{item.unit_price.toFixed(2)}</td><td>{(item.quantity * item.unit_price).toFixed(2)}</td></tr>)}</tbody></table><h3>Total: {total.toFixed(2)}</h3></section>
        <section><h2>Verification protocol</h2><table className="handbook-table"><thead><tr><th>Circuit</th><th>Test</th><th>Value</th><th>Limit</th><th>Result</th><th>Date</th></tr></thead><tbody>{data.measurements.map((item) => <tr key={item.id}><td>{data.circuits.find((circuit) => circuit.id === item.circuit_id)?.name ?? "General"}</td><td>{item.kind}</td><td>{item.measured_value} {item.unit}</td><td>{item.limit_value ?? "—"}</td><td>{item.passed ? "PASS" : "REVIEW"}</td><td>{item.measured_at}</td></tr>)}</tbody></table></section>
        {annotation.legend && <section><h2>Legend</h2><p>{annotation.legend}</p></section>}
        <footer className="handbook-footer">Generated by elplan · {new Date().toLocaleDateString()}</footer>
      </div>
    </div>
  );
}
