import { api } from "../../lib/api-client";

export type Role = "owner" | "admin" | "member";
export type Organization = { id: number; name: string; role: Role };
export type Member = { user_id: number; email: string; name: string; role: Role };
export type Team = { id: number; organization_id: number; name: string };

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const orgApi = {
  list: () => api<Organization[]>("/organizations"),
  create: (name: string) => api<Organization>("/organizations", json("POST", { name })),
  members: (orgId: number) => api<Member[]>(`/organizations/${orgId}/members`),
  addMember: (orgId: number, email: string, role: Role) =>
    api<Member>(`/organizations/${orgId}/members`, json("POST", { email, role })),
  setRole: (orgId: number, userId: number, role: Role) =>
    api<Member>(`/organizations/${orgId}/members/${userId}`, json("PATCH", { role })),
  removeMember: (orgId: number, userId: number) =>
    api<void>(`/organizations/${orgId}/members/${userId}`, json("DELETE")),
  teams: (orgId: number) => api<Team[]>(`/organizations/${orgId}/teams`),
  createTeam: (orgId: number, name: string) =>
    api<Team>(`/organizations/${orgId}/teams`, json("POST", { name })),
  deleteTeam: (orgId: number, teamId: number) =>
    api<void>(`/organizations/${orgId}/teams/${teamId}`, json("DELETE")),
  teamMembers: (orgId: number, teamId: number) =>
    api<Member[]>(`/organizations/${orgId}/teams/${teamId}/members`),
  addTeamMember: (orgId: number, teamId: number, userId: number) =>
    api<Member>(`/organizations/${orgId}/teams/${teamId}/members`, json("POST", { user_id: userId })),
  removeTeamMember: (orgId: number, teamId: number, userId: number) =>
    api<void>(`/organizations/${orgId}/teams/${teamId}/members/${userId}`, json("DELETE")),
};
