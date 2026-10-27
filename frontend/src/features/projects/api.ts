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

export const projectsApi = {
  list: () => api<Project[]>("/projects"),
  create: (payload: ProjectCreate) =>
    api<Project>("/projects", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
