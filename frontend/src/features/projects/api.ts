import { api } from "../../lib/api-client";

export type Project = {
  id: number;
  organization_id: number;
  team_id?: number | null;
  name: string;
  description?: string | null;
};

export type ProjectCreate = {
  organization_id: number;
  team_id?: number | null;
  name: string;
  description?: string;
};

export type Floor = {
  id: number;
  name: string;
  sort_order: number;
};

export type Building = {
  id: number;
  project_id: number;
  name: string;
  floors: Floor[];
};

export type BuildingCreate = {
  name: string;
  floors: { name: string }[];
};

export const projectsApi = {
  list: () => api<Project[]>("/projects"),
  get: (projectId: number) => api<Project>(`/projects/${projectId}`),
  create: (payload: ProjectCreate) =>
    api<Project>("/projects", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  buildings: (projectId: number) => api<Building[]>(`/projects/${projectId}/buildings`),
  createBuilding: (projectId: number, payload: BuildingCreate) =>
    api<Building>(`/projects/${projectId}/buildings`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
