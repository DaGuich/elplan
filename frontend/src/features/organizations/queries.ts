import { useQuery } from "@tanstack/react-query";
import { orgApi } from "./api";

export const useOrganizations = () => useQuery({ queryKey: ["orgs"], queryFn: orgApi.list });

export const useTeams = (orgId?: number) =>
  useQuery({
    queryKey: ["teams", orgId],
    queryFn: () => orgApi.teams(orgId!),
    enabled: orgId !== undefined,
  });
