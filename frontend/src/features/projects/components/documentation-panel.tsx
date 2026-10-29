import { ChangeEvent, FormEvent, useId, useMemo, useState } from "react";

import {
  ElectricalCircuit,
  FloorPlanData,
  PriceEntry,
  ProjectAnnotation,
  ResidualCurrentDevice,
  TestMeasurement,
} from "../api";
import { cropLayout } from "../domain/plan-crop";
import { useParams, Link } from "@tanstack/react-router";

import { applyPricingTemplates } from "../domain/pricing";
import { resolveProjectIdentity } from "../domain/project-identity";
import { useProjectDetails } from "../queries";
import { hasPolygon, labelAnchor, roomPath } from "../domain/plan-rooms";
import { useI18n } from "../../../i18n";

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
  const { t } = useI18n();
  const clipId = `handbook-plan-clip-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const [importMessage, setImportMessage] = useState("");
  const [templateMessage, setTemplateMessage] = useState("");
  const { projectId } = useParams({ strict: false });
  const numericProjectId = Number(projectId);
  const details = useProjectDetails(numericProjectId);
  const templates = details.data?.pricing_templates ?? [];
  const annotation = data.annotation;
  const identity = resolveProjectIdentity(details.data, annotation);
  const total = data.prices.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
  const passed = data.measurements.filter((item) => item.passed).length;
  const cropView = cropLayout(data, data.background_rotation);

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
      setImportMessage(t("Test protocol CSV must be 2 MB or smaller."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        setImportMessage(t("Could not read the selected protocol."));
        return;
      }
      const lines = reader.result.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) {
        setImportMessage(t("CSV must include a header and at least one test row."));
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
        setImportMessage(t("No valid measurement rows were found."));
        return;
      }
      onChange({ measurements: [...data.measurements, ...imported] });
      setImportMessage(t("{{count}} test measurements imported.", { count: imported.length }));
    };
    reader.onerror = () => setImportMessage(t("Could not read the selected protocol."));
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
      [t("Category"), t("Description"), t("Quantity"), t("Unit"), t("Unit price"), t("Total")],
      ...data.prices.map((item) => [t(item.category), t(item.name), item.quantity, t(item.unit), item.unit_price.toFixed(2), (item.quantity * item.unit_price).toFixed(2)]),
      ["", t("Grand total"), "", "", "", total.toFixed(2)],
    ];
    const csv = rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-bill-of-materials.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function applyTemplates() {
    const result = applyPricingTemplates(data.prices, templates);
    if (result.applied) onChange({ prices: result.prices });
    setTemplateMessage(t("{{count}} prices filled from project templates.", { count: result.applied }));
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
        <div><p className="eyebrow">{t("PROJECT DOCUMENTATION")}</p><h4>{t("Handbook, pricing and verification records")}</h4><p>{t("Project cover, legends, test values, terminal plans, and materials/pricing are part of the printable handover.")}</p></div>
        <div className="workspace-actions"><button type="button" className="button-secondary" onClick={exportBom}>{t("Export BOM CSV")}</button><button type="button" className="button-primary" onClick={() => window.print()}>{t("Print project handbook / PDF")}</button></div>
      </header>
      <div className="documentation-grid">
        <section className="documentation-card">
          <h5>{t("Title block & presentation")}</h5>
          <label>{t("Document title")}<input value={annotation.title} onChange={(event) => updateAnnotation({ title: event.target.value })} /></label>
          <div className="field-hint" data-testid="project-identity">
            <p>{t("Customer / client")}: <strong>{identity.customer || "—"}</strong>{identity.customerLegacy && ` (${t("legacy floor value")})`}</p>
            <p>{t("Project number")}: <strong>{identity.number || "—"}</strong>{identity.numberLegacy && ` (${t("legacy floor value")})`}</p>
            <p>{t("Customer and project number are managed in the project details.")}</p>
          </div>
          <label>{t("Presentation mode")}<select value={annotation.presentation_mode} onChange={(event) => updateAnnotation({ presentation_mode: event.target.value as ProjectAnnotation["presentation_mode"] })}><option value="planning">{t("Planning / technical")}</option><option value="client">{t("Client consultation")}</option></select></label>
          <label>{t("Legend")}<textarea rows={4} value={annotation.legend} onChange={(event) => updateAnnotation({ legend: event.target.value })} /></label>
          <label>{t("Project notes")}<textarea rows={5} value={annotation.notes} onChange={(event) => updateAnnotation({ notes: event.target.value })} /></label>
        </section>
        <section className="documentation-card">
          <div className="card-title-row"><h5>{t("Verification / test protocol")}</h5><label className="button-secondary import-file-button">{t("Import protocol CSV")}<input type="file" accept=".csv,text/csv" onChange={importProtocol} /></label></div>
          <p className="field-hint">{t("CSV columns: circuit, test, value, unit, limit, result, date, notes. Compatible measurement records can be imported from test systems.")}</p>
          {importMessage && <p className="editor-status">{importMessage}</p>}
          <div className="test-summary"><strong>{passed} {t("passed")}</strong><span>{data.measurements.length - passed} {t("review")}</span><span>{data.measurements.length} {t("total records")}</span></div>
          <div className="measurement-list">
            {data.measurements.map((item) => (
              <article className={item.passed ? "measurement-row passed" : "measurement-row failed"} key={item.id}>
                <select aria-label={t("Measurement type")} value={item.kind} onChange={(event) => onChange({ measurements: data.measurements.map((row) => row.id === item.id ? { ...row, kind: event.target.value as TestMeasurement["kind"] } : row) })}>{measurementKinds.map((kind) => <option key={kind} value={kind}>{t(kind)}</option>)}</select>
                <select aria-label={t("Measurement circuit")} value={item.circuit_id ?? ""} onChange={(event) => onChange({ measurements: data.measurements.map((row) => row.id === item.id ? { ...row, circuit_id: event.target.value || null } : row) })}><option value="">{t("General")}</option>{data.circuits.map((circuit) => <option key={circuit.id} value={circuit.id}>{circuit.name}</option>)}</select>
                <input aria-label={t("Measured value")} type="number" step="any" value={item.measured_value} onChange={(event) => onChange({ measurements: data.measurements.map((row) => row.id === item.id ? { ...row, measured_value: Number(event.target.value) } : row) })} />
                <input aria-label={t("Unit")} value={item.unit} onChange={(event) => onChange({ measurements: data.measurements.map((row) => row.id === item.id ? { ...row, unit: event.target.value } : row) })} />
                <input aria-label={t("Limit value")} placeholder={t("Limit")} type="number" step="any" value={item.limit_value ?? ""} onChange={(event) => onChange({ measurements: data.measurements.map((row) => row.id === item.id ? { ...row, limit_value: event.target.value ? Number(event.target.value) : null } : row) })} />
                <select aria-label={t("Measurement result")} value={item.passed ? "passed" : "review"} onChange={(event) => onChange({ measurements: data.measurements.map((row) => row.id === item.id ? { ...row, passed: event.target.value === "passed" } : row) })}><option value="passed">{t("Pass")}</option><option value="review">{t("Review")}</option></select>
                <button className="icon-button" aria-label={t("Remove measurement")} type="button" onClick={() => onChange({ measurements: data.measurements.filter((row) => row.id !== item.id) })}>×</button>
              </article>
            ))}
          </div>
          <button type="button" className="text-button" onClick={addMeasurement}>＋ {t("Add measurement")}</button>
        </section>
      </div>
      <section className="documentation-card">
        <div className="card-title-row"><h5>{t("Price template & quantity take-off")}</h5><button type="button" className="button-secondary" onClick={refreshBom}>{t("Refresh quantities from plan")}</button></div>
        <p className="field-hint">{t("Quantities are counted from the plan and circuit schedule. Currency, VAT, hourly rate, markup and pricing templates are managed in the project details.")}</p>
        <div className="card-title-row">
          {Number.isFinite(numericProjectId) && <Link className="text-button" to="/projects/$projectId/details" params={{ projectId: String(numericProjectId) }}>{t("Edit project pricing")}</Link>}
          <button type="button" className="button-secondary" disabled={!templates.length || !data.prices.length} onClick={applyTemplates}>{t("Apply project pricing templates")}</button>
        </div>
        <p className="field-hint">{t("Totals shown here are net sums of quantity × unit price. VAT, material markup and hourly rates from the project details are not included.")}</p>
        {templateMessage && <p className="editor-status" role="status">{templateMessage}</p>}
        <div className="bom-table-wrap"><table className="bom-table"><thead><tr><th>{t("Category")}</th><th>{t("Description")}</th><th>{t("Quantity")}</th><th>{t("Unit")}</th><th>{t("Unit price")}</th><th>{t("Line total")}</th><th /></tr></thead><tbody>
          {data.prices.map((item) => <tr key={item.id}>
            <td><select value={item.category} onChange={(event) => onChange({ prices: data.prices.map((row) => row.id === item.id ? { ...row, category: event.target.value as PriceEntry["category"] } : row) })}><option value="device">{t("Device")}</option><option value="labor">{t("Labor")}</option><option value="cable">{t("Cable")}</option><option value="other">{t("Other")}</option></select></td>
            <td><input value={t(item.name)} onChange={(event) => onChange({ prices: data.prices.map((row) => row.id === item.id ? { ...row, name: event.target.value } : row) })} /></td>
            <td><input type="number" min="0" step="any" value={item.quantity} onChange={(event) => onChange({ prices: data.prices.map((row) => row.id === item.id ? { ...row, quantity: Number(event.target.value) } : row) })} /></td>
            <td><input value={t(item.unit)} onChange={(event) => onChange({ prices: data.prices.map((row) => row.id === item.id ? { ...row, unit: event.target.value } : row) })} /></td>
            <td><input type="number" min="0" step="0.01" value={item.unit_price} onChange={(event) => onChange({ prices: data.prices.map((row) => row.id === item.id ? { ...row, unit_price: Number(event.target.value) } : row) })} /></td>
            <td>{(item.quantity * item.unit_price).toFixed(2)}</td>
            <td><button className="icon-button" aria-label={t("Remove {{name}}", { name: item.name })} type="button" onClick={() => onChange({ prices: data.prices.filter((row) => row.id !== item.id) })}>×</button></td>
          </tr>)}
          <tr className="bom-total"><td colSpan={5}>{t("Project total")}</td><td>{total.toFixed(2)}</td><td /></tr>
        </tbody></table></div>
        <form className="manual-price-form" onSubmit={addManualPrice}>
          <input name="name" required placeholder={t("Custom item or cabling")} />
          <select name="category"><option value="device">{t("Device")}</option><option value="labor">{t("Labor")}</option><option value="cable">{t("Cable")}</option><option value="other">{t("Other")}</option></select>
          <input name="quantity" type="number" min="0.01" step="any" defaultValue="1" />
          <input name="unit" defaultValue={t("piece")} />
          <input name="price" type="number" min="0" step="0.01" defaultValue="0" />
          <button type="submit" className="button-secondary">＋ {t("Add price item")}</button>
        </form>
      </section>
      <section className="documentation-card">
        <h5>{t("Terminal plan & calculated rail widths")}</h5>
        {terminalRows.length === 0 && <p className="empty-panel">{t("Add circuits and their terminal groups appear here automatically.")}</p>}
        <div className="terminal-plan-list">
          {terminalRows.map((strip) => {
            const width = (strip.circuit_ids.length * strip.terminals_per_circuit + strip.end_brackets + strip.separators) * strip.terminal_width_mm;
            return             <article className="terminal-plan-row" key={strip.id}><strong>{strip.name}</strong><span>{t(strip.kind)}</span><span>{strip.circuit_ids.length * strip.terminals_per_circuit} {t("Terminals")}</span><span>{width.toFixed(1)} mm</span><span>{strip.terminal_width_mm} mm / {t("terminal")}</span></article>;
          })}
        </div>
      </section>
      <div className="print-handbook">
        <header className="handbook-cover"><p>{t("ELPLAN · ELECTRICAL PLANNING")}</p><h1>{annotation.title || projectName}</h1><h2>{floorName}</h2><p>{identity.customer} {identity.number && `· ${identity.number}`}</p></header>
        {annotation.notes && <section><h2>{t("Project notes")}</h2><p>{annotation.notes}</p></section>}
        <section><h2>{t("Floor plan & installation points")}</h2><svg viewBox="0 0 1000 700" className="handbook-plan">
          <defs><clipPath id={clipId}><rect width="1000" height="700" /></clipPath>{cropView.clip && <clipPath id={`${clipId}-crop`}><rect {...cropView.clip} /></clipPath>}</defs>
          {data.background_image && <g clipPath={`url(#${clipId})`} opacity={data.background_opacity}><g transform={`rotate(${data.background_rotation},500,350)`}><image href={data.background_image} {...cropView.image} preserveAspectRatio="none" clipPath={cropView.clip ? `url(#${clipId}-crop)` : undefined} /></g></g>}
          {data.rooms.map((room) => <g key={room.id}>{hasPolygon(room) ? <path d={roomPath(room)} fillRule="evenodd" fill={room.color} fillOpacity=".45" stroke="#68877f" strokeWidth="2" /> : <rect x={room.x} y={room.y} width={room.width} height={room.height} fill={room.color} fillOpacity=".45" stroke="#68877f" strokeWidth="2" />}{hasPolygon(room) ? <text x={labelAnchor(room).x} y={labelAnchor(room).y} textAnchor="middle">{room.name}</text> : <text x={room.x + 10} y={room.y + 22}>{room.name}</text>}</g>)}
          {data.placements.map((item) => <g key={item.id} transform={`translate(${item.x},${item.y}) rotate(${item.rotation})`}><circle r="13" fill="#fff" stroke={item.color} strokeWidth="2" /><text textAnchor="middle" dominantBaseline="central" fontSize="8">{item.element_id || item.kind.slice(0, 3).toUpperCase()}</text><text y="25" textAnchor="middle" fontSize="9">{item.label}</text></g>)}
        </svg><p>{data.rooms.length} {t("rooms")} · {data.placements.length} {t("installation points")} · {t("scale")} {data.scale_m_per_100_units ?? t("not calibrated")} m / 100 {t("units")}</p></section>
        <section><h2>{t("Circuits & protection")}</h2>{data.rcds.map((rcd, index) => <div key={rcd.id}><h3>F{index + 1} · {rcd.name} · {t("Type")} {rcd.type} · {rcd.rated_current_ma} mA</h3><table className="handbook-table"><thead><tr><th>{t("Ref.")}</th><th>{t("Circuit")}</th><th>{t("MCB")}</th><th>{t("Supply")}</th><th>{t("Cable")}</th><th>{t("Loads")}</th></tr></thead><tbody>{data.circuits.filter((circuit) => circuit.rcd_id === rcd.id).map((circuit) => <tr key={circuit.id}><td>{circuitNumber(circuit, data.rcds, data.circuits)}</td><td>{circuit.name}</td><td>{circuit.poles}P {circuit.breaker_type}{circuit.rated_current_a}</td><td>{t(circuit.supply)}</td><td>{circuit.cable}</td><td>{circuit.loads.map((loadId) => data.placements.find((item) => item.id === loadId)?.label).filter(Boolean).join(", ")}</td></tr>)}</tbody></table><p>{circuitTotals.get(rcd.id) ?? 0} {t("circuits")} · X{index + 1} {t("terminal group")}</p></div>)}</section>
        <section><h2>{t("Cabinet assembly plan")}</h2><p>{t(data.cabinet.name)} · {data.cabinet.manufacturer ?? ""} {data.cabinet.model ?? ""} · {data.cabinet.rows} {t("rows")} × {data.cabinet.columns} TE</p>{data.cabinet.rails.map((rail) => <p key={rail.id}><strong>{t(rail.name)}:</strong> {data.cabinet.modules.filter((module) => module.rail_id === rail.id).sort((a, b) => a.position - b.position).map((module) => t("{{name}} ({{width}} TE, position {{position}})", { name: t(module.name), width: module.te_width, position: module.position + 1 })).join(" · ") || t("spare space")}</p>)}{data.cabinet.mounting_notes && <p>{data.cabinet.mounting_notes}</p>}</section>
        <section><h2>{t("Smart building & bus devices")}</h2>{data.smart_devices.map((device) => <article key={device.id}><h3>{device.system.toUpperCase()} · {device.name}</h3><p>{device.model} {device.line} {device.address}</p>{device.channels.map((channel) => <p key={channel.id}>{channel.name} ({t(channel.kind)}, {channel.address}) → {channel.load_ids.map((id) => data.placements.find((item) => item.id === id)?.label).filter(Boolean).join(", ")}</p>)}</article>)}</section>
        <section><h2>{t("Terminal plan & bill of materials")}</h2>{terminalRows.map((strip) => <p key={strip.id}>{strip.name}: {strip.circuit_ids.length * strip.terminals_per_circuit} {t("Terminals")}, {((strip.circuit_ids.length * strip.terminals_per_circuit + strip.end_brackets + strip.separators) * strip.terminal_width_mm).toFixed(1)} mm</p>)}<table className="handbook-table"><thead><tr><th>{t("Item")}</th><th>{t("Quantity")}</th><th>{t("Unit price")}</th><th>{t("Total")}</th></tr></thead><tbody>{data.prices.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.quantity} {t(item.unit)}</td><td>{item.unit_price.toFixed(2)}</td><td>{(item.quantity * item.unit_price).toFixed(2)}</td></tr>)}</tbody></table><h3>{t("Total")}: {total.toFixed(2)}</h3></section>
        <section><h2>{t("Verification protocol")}</h2><table className="handbook-table"><thead><tr><th>{t("Circuit")}</th><th>{t("Test")}</th><th>{t("Value")}</th><th>{t("Limit")}</th><th>{t("Result")}</th><th>{t("Date")}</th></tr></thead><tbody>{data.measurements.map((item) => <tr key={item.id}><td>{data.circuits.find((circuit) => circuit.id === item.circuit_id)?.name ?? t("General")}</td><td>{t(item.kind)}</td><td>{item.measured_value} {item.unit}</td><td>{item.limit_value ?? "—"}</td><td>{item.passed ? t("PASS") : t("REVIEW")}</td><td>{item.measured_at}</td></tr>)}</tbody></table></section>
        {annotation.legend && <section><h2>{t("Legend")}</h2><p>{annotation.legend}</p></section>}
        <footer className="handbook-footer">{t("Generated by elplan · {{date}}", { date: new Date().toLocaleDateString() })}</footer>
      </div>
    </div>
  );
}
