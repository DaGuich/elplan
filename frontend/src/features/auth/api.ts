import { api } from "../../lib/api-client";

export type User = { id: number; email: string; name: string };

export type AuthConfig = { oauth_enabled: boolean; oauth_provider_name: string };

export const authApi = {
  config: () => api<AuthConfig>("/auth/config"),
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
