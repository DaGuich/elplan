import type { FloorPlanData } from "../api";

export type LoadedWorkspace = { floorId: number; data: FloorPlanData };

export function reconcileWorkspaceRefresh(
  current: FloorPlanData,
  previous: LoadedWorkspace | null,
  floorId: number,
  next: FloorPlanData,
  acknowledgedSave = false,
): FloorPlanData {
  if (!previous || previous.floorId !== floorId || current === previous.data) return next;
  return acknowledgedSave ? { ...current, topology_revision: next.topology_revision } : current;
}
