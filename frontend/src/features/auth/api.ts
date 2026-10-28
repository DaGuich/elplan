import { api } from "../../lib/api-client";

export type User = { id: number; email: string; name: string };

export type AuthConfig = { oauth_enabled: boolean; oauth_provider_name: string };

export const authApi = {
  config: () => api<AuthConfig>("/auth/config"),
  me: () => api<User>("/users/me"),
};
