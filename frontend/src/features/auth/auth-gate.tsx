import { ReactNode, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { tokenStore } from "../../lib/api-client";
import { authApi } from "./api";

export function AuthGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [hasToken, setHasToken] = useState(() => {
    // The OAuth callback redirects back with the app token in the URL fragment.
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const token = params.get("token");
    if (token) {
      tokenStore.set(token);
      window.history.replaceState(null, "", window.location.pathname);
    }
    return !!tokenStore.get();
  });
  const me = useQuery({ queryKey: ["me"], queryFn: authApi.me, enabled: hasToken, retry: false });

  useEffect(() => {
    const onLogout = () => {
      setHasToken(false);
      queryClient.clear();
    };
    window.addEventListener("elplan:logout", onLogout);
    return () => window.removeEventListener("elplan:logout", onLogout);
  }, [queryClient]);

  if (!hasToken) {
    return <LoginForm onDone={() => setHasToken(true)} />;
  }
  if (me.isLoading) {
    return <p>Loading...</p>;
  }
  if (me.isError || !me.data) {
    return (
      <LoginForm
        onDone={() => {
          setHasToken(true);
          void me.refetch();
        }}
      />
    );
  }

  return (
    <>
      <div className="flex items-center justify-end gap-3 bg-slate-900 px-4 py-1.5 text-xs text-slate-200 sm:px-8">
        <span>{me.data.name}</span>
        <button
          className="!border-slate-600 !bg-transparent !px-2 !py-0.5 !text-xs !text-slate-200 hover:!bg-slate-800"
          onClick={() => {
            tokenStore.clear();
            window.dispatchEvent(new Event("elplan:logout"));
          }}
        >
          Log out
        </button>
      </div>
      {children}
    </>
  );
}

function LoginForm({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(() => {
    const err = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("error");
    if (err) {
      window.history.replaceState(null, "", window.location.pathname);
    }
    return err ? `Login failed: ${err}` : null;
  });
  const config = useQuery({ queryKey: ["auth-config"], queryFn: authApi.config });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (mode === "register") {
        await authApi.register(email, name, password);
      }
      const { access_token } = await authApi.login(email, password);
      tokenStore.set(access_token);
      onDone();
    } catch (err) {
      setError(mode === "login" ? "Invalid email or password" : "Registration failed");
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto mt-16 grid w-full max-w-sm gap-3 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold">{mode === "login" ? "Log in" : "Register"}</h2>
      <input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      {mode === "register" && (
        <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
      )}
      <input
        placeholder="Password (min. 8 characters)"
        type="password"
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit">{mode === "login" ? "Log in" : "Register"}</button>
      {config.data?.oauth_enabled && (
        <a className="rounded-md border border-slate-300 bg-white px-4 py-2 text-center text-sm font-medium text-slate-700 hover:bg-slate-50" href="/api/v1/auth/oauth/login">
          Log in with {config.data.oauth_provider_name}
        </a>
      )}
      {config.isError && <p role="alert" className="text-sm text-red-600">Could not load SSO configuration.</p>}
      {config.data && !config.data.oauth_enabled && (
        <p className="text-sm text-slate-500">SSO login is not configured on this server.</p>
      )}
      <button type="button" className="text-sm text-emerald-700 hover:underline" onClick={() => setMode(mode === "login" ? "register" : "login")}>
        {mode === "login" ? "Create an account" : "I already have an account"}
      </button>
    </form>
  );
}
