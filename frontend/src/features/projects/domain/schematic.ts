import { ElectricalCircuit, FloorPlanData, PlanPlacement, ResidualCurrentDevice, TopologyPlacement } from "../api";

export type SchematicMode = "single-line" | "multi-line";

export type SchematicIssue = {
  code: "missing-rcd" | "missing-load" | "missing-circuit" | "conflicting-load-assignment" | "unlisted-circuit-load" | "missing-upstream-rcd" | "rcd-cycle";
  circuitId?: string;
  rcdId?: string;
  loadId?: string;
  relatedId?: string;
};

export type SchematicCircuit = {
  circuit: ElectricalCircuit;
  rcd: ResidualCurrentDevice | null;
  loads: SchematicLoad[];
  missingLoadIds: string[];
  unresolvedLoadIds: string[];
  poles: number[];
};

export type SchematicLoad =
  | { source: "local"; placement: PlanPlacement }
  | { source: "project"; placement: TopologyPlacement };

export type SchematicGroup = {
  rcd: ResidualCurrentDevice;
  upstream: ResidualCurrentDevice | null;
  circuits: SchematicCircuit[];
};

export type SchematicModel = {
  groups: SchematicGroup[];
  disconnectedCircuits: SchematicCircuit[];
  issues: SchematicIssue[];
  remotePlacementsStatus: "not-provided" | "loading" | "available" | "unavailable";
};

export type SchematicData = Pick<FloorPlanData, "rcds" | "circuits" | "placements">;
export type SchematicRemotePlacements = {
  placements?: readonly TopologyPlacement[];
  status?: "loading" | "available" | "unavailable";
};

export function buildSchematicModel(data: SchematicData, remote: SchematicRemotePlacements = {}): SchematicModel {
  const rcdById = new Map(data.rcds.map((rcd) => [rcd.id, rcd]));
  const circuitById = new Map(data.circuits.map((circuit) => [circuit.id, circuit]));
  const placementById = new Map(data.placements.map((placement) => [placement.id, placement]));
  const topologyPlacementById = new Map((remote.placements ?? []).map((placement) => [placement.id, placement]));
  const remotePlacementsStatus = remote.status ?? (remote.placements ? "available" : "not-provided");
  const canResolveRemoteReferences = remotePlacementsStatus === "available";
  const issues: SchematicIssue[] = [];

  for (const rcd of data.rcds) {
    if (rcd.upstream_id && !rcdById.has(rcd.upstream_id)) {
      issues.push({ code: "missing-upstream-rcd", rcdId: rcd.id, relatedId: rcd.upstream_id });
    }
  }

  const rcdState = new Map<string, "visiting" | "visited">();
  const reportedCycles = new Set<string>();
  const visitRcd = (rcdId: string, path: string[]) => {
    const state = rcdState.get(rcdId);
    if (state === "visited") return;
    if (state === "visiting") {
      const start = path.indexOf(rcdId);
      const cycle = path.slice(start).sort().join("|");
      if (!reportedCycles.has(cycle)) {
        reportedCycles.add(cycle);
        issues.push({ code: "rcd-cycle", rcdId });
      }
      return;
    }

    rcdState.set(rcdId, "visiting");
    const rcd = rcdById.get(rcdId);
    if (rcd?.upstream_id && rcdById.has(rcd.upstream_id)) visitRcd(rcd.upstream_id, [...path, rcdId]);
    rcdState.set(rcdId, "visited");
  };
  for (const rcd of data.rcds) visitRcd(rcd.id, []);

  const schematicCircuits = data.circuits.map((circuit): SchematicCircuit => {
    const rcd = rcdById.get(circuit.rcd_id) ?? null;
    if (!rcd) issues.push({ code: "missing-rcd", circuitId: circuit.id, relatedId: circuit.rcd_id });

    const loads: SchematicLoad[] = [];
    const missingLoadIds: string[] = [];
    const unresolvedLoadIds: string[] = [];
    for (const loadId of circuit.loads) {
      const localPlacement = placementById.get(loadId);
      if (localPlacement) {
        loads.push({ source: "local", placement: localPlacement });
        if (localPlacement.circuit_id && localPlacement.circuit_id !== circuit.id) {
          issues.push({
            code: "conflicting-load-assignment",
            circuitId: circuit.id,
            loadId,
            relatedId: localPlacement.circuit_id,
          });
        }
        continue;
      }

      const remotePlacement = topologyPlacementById.get(loadId);
      if (remotePlacement) {
        loads.push({ source: "project", placement: remotePlacement });
        continue;
      }

      unresolvedLoadIds.push(loadId);
      if (canResolveRemoteReferences) {
        missingLoadIds.push(loadId);
        issues.push({ code: "missing-load", circuitId: circuit.id, loadId });
      } else if (remotePlacementsStatus === "not-provided") {
        missingLoadIds.push(loadId);
        issues.push({ code: "missing-load", circuitId: circuit.id, loadId });
      }
    }

    return {
      circuit,
      rcd,
      loads,
      missingLoadIds,
      unresolvedLoadIds,
      poles: Array.from({ length: circuit.poles }, (_, index) => index + 1),
    };
  });

  const declaredLoads = new Set(data.circuits.flatMap((circuit) => circuit.loads));
  for (const placement of data.placements) {
    if (placement.circuit_id && !circuitById.has(placement.circuit_id)) {
      issues.push({ code: "missing-circuit", circuitId: placement.circuit_id, loadId: placement.id });
      continue;
    }
    if (placement.circuit_id && circuitById.has(placement.circuit_id) && !declaredLoads.has(placement.id)) {
      issues.push({
        code: "unlisted-circuit-load",
        circuitId: placement.circuit_id,
        loadId: placement.id,
      });
    }
  }

  return {
    groups: data.rcds.map((rcd) => ({
      rcd,
      upstream: rcd.upstream_id ? rcdById.get(rcd.upstream_id) ?? null : null,
      circuits: schematicCircuits.filter((item) => item.rcd?.id === rcd.id),
    })),
    disconnectedCircuits: schematicCircuits.filter((item) => !item.rcd),
    issues,
    remotePlacementsStatus,
  };
}
