import { ReactNode, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { tokenStore } from "../../lib/api-client";
import { authApi } from "./api";

export function AuthGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [hasToken, setHasToken] = useState(!!tokenStore.get());
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
    return <LoginForm onDone={() => setHasToken(true)} />;
  }

  return (
    <>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <span>{me.data.name}</span>
        <button
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
  const [error, setError] = useState<string | null>(null);

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
    <form onSubmit={submit} style={{ display: "grid", gap: 8, maxWidth: 320 }}>
      <h2>{mode === "login" ? "Log in" : "Register"}</h2>
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
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      <button type="submit">{mode === "login" ? "Log in" : "Register"}</button>
      <button type="button" onClick={() => setMode(mode === "login" ? "register" : "login")}>
        {mode === "login" ? "Create an account" : "I already have an account"}
      </button>
    </form>
  );
}
