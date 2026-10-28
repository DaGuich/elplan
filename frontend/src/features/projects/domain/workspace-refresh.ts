import type { FloorPlanData } from "../api";

export type LoadedWorkspace = { floorId: number; data: FloorPlanData };

export function reconcileWorkspaceRefresh(
  current: FloorPlanData,
  previous: LoadedWorkspace | null,
  floorId: number,
  next: FloorPlanData,
): FloorPlanData {
  return !previous || previous.floorId !== floorId || current === previous.data ? next : current;
}
