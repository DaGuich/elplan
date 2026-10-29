import { useMemo, useState } from "react";

import { FloorPlanData, TopologyPlacement } from "../api";
import { buildSchematicModel, SchematicIssue, SchematicMode } from "../domain/schematic";
import { useI18n } from "../../../i18n";
import "./schematic-view.css";

type Props = {
  data: Pick<FloorPlanData, "rcds" | "circuits" | "placements">;
  topologyPlacements?: readonly TopologyPlacement[];
  topologyPlacementsStatus?: "loading" | "available" | "unavailable";
};

function issueDescription(issue: SchematicIssue, t: (key: string, values?: Record<string, string | number>) => string) {
  switch (issue.code) {
    case "missing-rcd":
      return t("Circuit {{circuit}} refers to missing protection device {{rcd}}.", {
        circuit: issue.circuitId ?? "",
        rcd: issue.relatedId ?? "",
      });
    case "missing-load":
      return t("Circuit {{circuit}} refers to missing load {{load}}.", {
        circuit: issue.circuitId ?? "",
        load: issue.loadId ?? "",
      });
    case "missing-circuit":
      return t("Load {{load}} refers to missing circuit {{circuit}}.", {
        circuit: issue.circuitId ?? "",
        load: issue.loadId ?? "",
      });
    case "conflicting-load-assignment":
      return t("Load {{load}} is listed on circuit {{circuit}} but its stored circuit assignment is {{other}}.", {
        circuit: issue.circuitId ?? "",
        load: issue.loadId ?? "",
        other: issue.relatedId ?? "",
      });
    case "unlisted-circuit-load":
      return t("Load {{load}} refers to circuit {{circuit}} but is absent from that circuit’s load list.", {
        circuit: issue.circuitId ?? "",
        load: issue.loadId ?? "",
      });
    case "missing-upstream-rcd":
      return t("Protection device {{rcd}} refers to missing upstream device {{upstream}}.", {
        rcd: issue.rcdId ?? "",
        upstream: issue.relatedId ?? "",
      });
    case "rcd-cycle":
      return t("Protection device relationship contains a cycle at {{rcd}}.", { rcd: issue.rcdId ?? "" });
  }
}

export function SchematicView({ data, topologyPlacements, topologyPlacementsStatus }: Props) {
  const { t } = useI18n();
  const [mode, setMode] = useState<SchematicMode>("single-line");
  const model = useMemo(
    () => buildSchematicModel(data, { placements: topologyPlacements, status: topologyPlacementsStatus }),
    [data, topologyPlacements, topologyPlacementsStatus],
  );

  return (
    <section className="schematic-view" aria-label={t("Schematic preview")}>
      <header className="schematic-view__header">
        <div>
          <h2>{t("Schematic preview")}</h2>
          <p>{t("Displays stored protection, circuit, and load relationships only.")}</p>
        </div>
        <div className="schematic-view__modes" role="group" aria-label={t("Representation mode")}>
          <button type="button" aria-pressed={mode === "single-line"} onClick={() => setMode("single-line")}>{t("Single-line")}</button>
          <button type="button" aria-pressed={mode === "multi-line"} onClick={() => setMode("multi-line")}>{t("Multi-line")}</button>
        </div>
      </header>

      <p className="schematic-view__warning" role="note">
        <strong>{t("Non-compliant preview")}</strong>{" "}
        {t("This is not an IEC 60617 / DIN EN 60617 compliant drawing. Device boxes are descriptive only; verify against applicable standards before use.")}
      </p>

      {model.remotePlacementsStatus === "loading" && (
        <p className="schematic-view__status" role="status">{t("Project-wide load details are loading; unresolved load references are not treated as missing.")}</p>
      )}
      {model.remotePlacementsStatus === "unavailable" && (
        <p className="schematic-view__status" role="status">{t("Project-wide load details are unavailable; unresolved load references are not treated as missing.")}</p>
      )}

      {model.issues.length > 0 && (
        <div className="schematic-view__issues" role="alert">
          <strong>{t("Disconnected or inconsistent stored relationships")}</strong>
          <ul>{model.issues.map((issue, index) => <li key={`${issue.code}-${issue.circuitId ?? issue.rcdId}-${issue.loadId ?? issue.relatedId}-${index}`}>{issueDescription(issue, t)}</li>)}</ul>
        </div>
      )}

      {model.groups.length === 0 && model.disconnectedCircuits.length === 0 ? (
        <p className="schematic-view__empty">{t("No stored protection devices or circuits to preview.")}</p>
      ) : (
        <div className={`schematic-view__diagram schematic-view__diagram--${mode}`}>
          {model.groups.map(({ rcd, upstream, circuits }) => (
            <section className="schematic-group" key={rcd.id} aria-label={`${t("Protection device")}: ${rcd.name}`}>
              <article className="schematic-device schematic-device--protection">
                <span className="schematic-device__kind">{t("Residual current device (RCD)")}</span>
                <div className="schematic-symbol-placeholder" aria-label={t("Verified IEC/DIN symbol placeholder")}>
                  {t("IEC/DIN symbol placeholder")}
                </div>
                <strong>{rcd.name}</strong>
                <span>{t("Type {{type}} · {{current}} mA · {{poles}} poles", { type: rcd.type, current: rcd.rated_current_ma, poles: rcd.poles })}</span>
                <span className="schematic-unknown">{t("Pole/terminal assignments are not stored.")}</span>
                {upstream && <span>{t("Upstream protection")}: {upstream.name}</span>}
                {mode === "multi-line" && (
                  <div className="schematic-poles" aria-label={t("Conductor assignments")}>
                    {Array.from({ length: rcd.poles }, (_, index) => (
                      <div className="schematic-pole" key={index + 1}>
                        <span>{t("RCD pole {{number}}", { number: index + 1 })}</span>
                        <span>{t("Conductor, phase, and terminal unassigned")}</span>
                      </div>
                    ))}
                  </div>
                )}
              </article>
              <div className="schematic-circuits">
                {circuits.map(({ circuit, loads, missingLoadIds, unresolvedLoadIds, poles }) => (
                  <article className="schematic-circuit" key={circuit.id}>
                    <div className="schematic-device schematic-device--circuit">
                      <span className="schematic-device__kind">{t("Circuit breaker")}</span>
                      <div className="schematic-symbol-placeholder" aria-label={t("Verified IEC/DIN symbol placeholder")}>
                        {t("IEC/DIN symbol placeholder")}
                      </div>
                      <strong>{circuit.name}</strong>
                      <span>{circuit.poles}P · {circuit.breaker_type}{circuit.rated_current_a} A</span>
                      <span>{t("Supply")}: {t(circuit.supply)} · {t("Cable")}: {circuit.cable || t("Not specified")}</span>
                      <span className="schematic-unknown">{t("Conductor and terminal assignments are not stored.")}</span>
                    </div>
                    {mode === "multi-line" && (
                      <div className="schematic-poles" aria-label={t("Conductor assignments")}>
                        {poles.map((pole) => (
                          <div className="schematic-pole" key={pole}>
                            <span>{t("Pole {{number}}", { number: pole })}</span>
                            <span>{t("Conductor, phase, and terminal unassigned")}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="schematic-loads">
                      <span className="schematic-device__kind">{t("Stored loads")}</span>
                      {loads.length === 0 && missingLoadIds.length === 0 && unresolvedLoadIds.length === 0 && <span className="schematic-unknown">{t("No loads assigned")}</span>}
                      {loads.map((load) => load.source === "local"
                        ? <div className="schematic-load" key={load.placement.id}><strong>{load.placement.label || load.placement.kind}</strong><span>{t(load.placement.kind)}</span></div>
                        : <div className="schematic-load schematic-load--remote" key={load.placement.id}>
                          <strong>{load.placement.label}</strong>
                          <span>{t("Floor")}: {load.placement.floor_name}</span>
                          <span>{t("Kind and circuit assignment are unknown for project-wide load references.")}</span>
                        </div>)}
                      {missingLoadIds.map((id) => <div className="schematic-load schematic-load--missing" key={id}><strong>{t("Missing load")}</strong><span>{id}</span></div>)}
                      {unresolvedLoadIds.filter((id) => !missingLoadIds.includes(id)).map((id) => <div className="schematic-load schematic-load--unresolved" key={id}><strong>{t("Load reference unresolved")}</strong><span>{id}</span></div>)}
                    </div>
                    {mode === "multi-line" && <p className="schematic-unknown">{t("Stored circuit-to-load association does not assign conductors or load terminals.")}</p>}
                  </article>
                ))}
                {circuits.length === 0 && <p className="schematic-view__empty">{t("No outgoing circuits are stored for this protection device.")}</p>}
              </div>
            </section>
          ))}
          {model.disconnectedCircuits.map(({ circuit, loads, missingLoadIds, unresolvedLoadIds, poles }) => (
            <section className="schematic-group schematic-group--disconnected" key={circuit.id} aria-label={t("Disconnected circuit")}>
              <article className="schematic-device schematic-device--disconnected">
                <span className="schematic-device__kind">{t("Circuit without a stored protection device")}</span>
                <div className="schematic-symbol-placeholder" aria-label={t("Verified IEC/DIN symbol placeholder")}>
                  {t("IEC/DIN symbol placeholder")}
                </div>
                <strong>{circuit.name}</strong>
                <span>{circuit.poles}P · {circuit.breaker_type}{circuit.rated_current_a} A</span>
                <span>{t("Supply")}: {t(circuit.supply)} · {t("Cable")}: {circuit.cable || t("Not specified")}</span>
                <span className="schematic-unknown">{t("Conductor and terminal assignments are not stored.")}</span>
              </article>
              {mode === "multi-line" && (
                <div className="schematic-poles">
                  {poles.map((pole) => <div className="schematic-pole" key={pole}><span>{t("Pole {{number}}", { number: pole })}</span><span>{t("Conductor, phase, and terminal unassigned")}</span></div>)}
                </div>
              )}
              <div className="schematic-loads">
                <span className="schematic-device__kind">{t("Stored loads")}</span>
                {loads.map((load) => load.source === "local"
                  ? <div className="schematic-load" key={load.placement.id}><strong>{load.placement.label || load.placement.kind}</strong><span>{t(load.placement.kind)}</span></div>
                  : <div className="schematic-load schematic-load--remote" key={load.placement.id}>
                    <strong>{load.placement.label}</strong>
                    <span>{t("Floor")}: {load.placement.floor_name}</span>
                    <span>{t("Kind and circuit assignment are unknown for project-wide load references.")}</span>
                  </div>)}
                {missingLoadIds.map((id) => <div className="schematic-load schematic-load--missing" key={id}><strong>{t("Missing load")}</strong><span>{id}</span></div>)}
                {unresolvedLoadIds.filter((id) => !missingLoadIds.includes(id)).map((id) => <div className="schematic-load schematic-load--unresolved" key={id}><strong>{t("Load reference unresolved")}</strong><span>{id}</span></div>)}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
