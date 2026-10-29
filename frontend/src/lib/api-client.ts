const API_BASE = "/api/v1";
const TOKEN_KEY = "elplan.token";

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export async function api<T>(path: string, init?: RequestInit, onResponse?: (response: Response) => void): Promise<T> {
  const token = tokenStore.get();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  if (res.status === 401 && token) {
    tokenStore.clear();
    window.dispatchEvent(new Event("elplan:logout"));
  }
  if (!res.ok) {
    throw new ApiError(res.status, await res.text());
  }
  onResponse?.(res);
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}
