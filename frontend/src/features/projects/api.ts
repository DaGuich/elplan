import { api } from "../../lib/api-client";

export type Project = {
  id: number;
  name: string;
  description?: string | null;
};

export type ProjectCreate = {
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
