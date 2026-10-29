import { api } from "../../../lib/api-client";

export type DistributionBoard = {
  id: number;
  project_id: number;
  name: string;
  kind: "main" | "sub";
  floor_id: number | null;
  data: Record<string, unknown>;
};

export type DistributionBoardInput = Pick<DistributionBoard, "name" | "kind" | "floor_id" | "data">;

export const boardManagementApi = {
  list: async (projectId: number) => {
    let revision: string | null = null;
    const boards = await api<DistributionBoard[]>(`/projects/${projectId}/boards`, undefined, (response) => {
      revision = response.headers.get("X-Topology-Revision");
    });
    if (revision === null || !/^\d+$/.test(revision)) throw new Error("Missing topology revision");
    return { boards, revision };
  },
  create: (projectId: number, input: DistributionBoardInput, revision: string) =>
    api<DistributionBoard>(`/projects/${projectId}/boards`, {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "If-Match": revision },
    }),
  update: (projectId: number, boardId: number, input: DistributionBoardInput, revision: string) =>
    api<DistributionBoard>(`/projects/${projectId}/boards/${boardId}`, {
      method: "PUT",
      body: JSON.stringify(input),
      headers: { "If-Match": revision },
    }),
  delete: (projectId: number, boardId: number, revision: string) =>
    api<void>(`/projects/${projectId}/boards/${boardId}`, { method: "DELETE", headers: { "If-Match": revision } }),
};
