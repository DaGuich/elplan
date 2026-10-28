import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BuildingCreate, FloorPlanData, ProjectCreate, Project, projectsApi } from "./api";

export function useProjects(includeArchived = false) {
  return useQuery({
    queryKey: ["projects", { includeArchived }],
    queryFn: () => projectsApi.list(includeArchived),
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

export function useFloorPlan(projectId: number, floorId: number | undefined) {
  return useQuery({
    queryKey: ["projects", projectId, "floors", floorId, "plan"],
    queryFn: () => projectsApi.floorPlan(projectId, floorId!),
    enabled: floorId !== undefined,
  });
}

export function useSaveFloorPlan(projectId: number, floorId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: FloorPlanData) => projectsApi.saveFloorPlan(projectId, floorId, payload),
    onSuccess: (data) => {
      queryClient.setQueryData(["projects", projectId, "floors", floorId, "plan"], data);
    },
  });
}

export function useUpdateProject(projectId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Pick<Project, "name" | "description" | "archived" | "team_id">>) =>
      projectsApi.updateProject(projectId, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["projects", projectId] });
    },
  });
}

export function useDuplicateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: projectsApi.duplicateProject,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useManageProjectStructure(projectId: number) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["projects", projectId, "buildings"] });
  return {
    updateBuilding: useMutation({
      mutationFn: ({ buildingId, name }: { buildingId: number; name: string }) =>
        projectsApi.updateBuilding(projectId, buildingId, name),
      onSuccess: refresh,
    }),
    deleteBuilding: useMutation({
      mutationFn: projectsApi.deleteBuilding.bind(null, projectId),
      onSuccess: refresh,
    }),
    createFloor: useMutation({
      mutationFn: ({ buildingId, name }: { buildingId: number; name: string }) =>
        projectsApi.createFloor(projectId, buildingId, name),
      onSuccess: refresh,
    }),
    updateFloor: useMutation({
      mutationFn: ({ floorId, name }: { floorId: number; name: string }) =>
        projectsApi.updateFloor(projectId, floorId, name),
      onSuccess: refresh,
    }),
    duplicateFloor: useMutation({
      mutationFn: projectsApi.duplicateFloor.bind(null, projectId),
      onSuccess: refresh,
    }),
    deleteFloor: useMutation({
      mutationFn: projectsApi.deleteFloor.bind(null, projectId),
      onSuccess: refresh,
    }),
  };
}
