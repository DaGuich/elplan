import { api } from "../../lib/api-client";

export type User = { id: number; email: string; name: string };

export const authApi = {
  me: () => api<User>("/users/me"),
  login: (email: string, password: string) =>
    api<{ access_token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  register: (email: string, name: string, password: string) =>
    api<User>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, name, password }),
    }),
};
