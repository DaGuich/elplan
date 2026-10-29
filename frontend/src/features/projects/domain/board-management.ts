import { DistributionBoard, DistributionBoardInput } from "../components/board-management-api";

export type BoardFormValues = {
  name: string;
  kind: "main" | "sub";
  floorId: string;
};

export function boardFormValues(board?: DistributionBoard): BoardFormValues {
  return {
    name: board?.name ?? "",
    kind: board?.kind ?? "sub",
    floorId: board?.floor_id == null ? "" : String(board.floor_id),
  };
}

export function boardInput(values: BoardFormValues, existing?: DistributionBoard): DistributionBoardInput {
  return {
    name: values.name.trim(),
    kind: values.kind,
    floor_id: values.floorId ? Number(values.floorId) : null,
    data: existing?.data ?? {},
  };
}
