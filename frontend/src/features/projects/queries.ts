import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BuildingCreate, ProjectCreate, projectsApi } from "./api";

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: projectsApi.list,
  });
}

export function useProject(projectId: number) {
  return useQuery({
    queryKey: ["projects", projectId],
    queryFn: () => projectsApi.get(projectId),
  });
}

export function useBuildings(projectId: number) {
  return useQuery({
    queryKey: ["projects", projectId, "buildings"],
    queryFn: () => projectsApi.buildings(projectId),
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: ProjectCreate) => projectsApi.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useCreateBuilding(projectId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: BuildingCreate) => projectsApi.createBuilding(projectId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects", projectId, "buildings"] });
    },
  });
}
