import { ReactNode, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { tokenStore } from "../../lib/api-client";
import { authApi } from "./api";
import { LanguageSelect, useI18n } from "../../i18n";

export function AuthGate({ children }: { children: ReactNode }) {
  const { t } = useI18n();
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
    return <IdentityProviderLogin />;
  }
  if (me.isLoading) {
    return <p>{t("Loading...")}</p>;
  }
  if (me.isError || !me.data) {
    return (
      <IdentityProviderLogin />
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
          {t("Log out")}
        </button>
      </div>
      {children}
    </>
  );
}

function IdentityProviderLogin() {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(() => {
    const err = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("error");
    if (err) {
      window.history.replaceState(null, "", window.location.pathname);
    }
    return err;
  });
  const config = useQuery({ queryKey: ["auth-config"], queryFn: authApi.config });

  return (
    <main className="mx-auto mt-16 grid w-full max-w-sm gap-3 rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
      <div className="flex justify-end"><LanguageSelect /></div>
      <h2 className="text-xl font-semibold">{t("Sign in")}</h2>
      <p className="text-sm text-slate-600">{t("Continue with your identity provider to access elplan.")}</p>
      {error && <p role="alert" className="text-sm text-red-600">{t("Sign-in failed: {{error}}", { error })}</p>}
      {config.isLoading && <p className="text-sm text-slate-500">{t("Checking identity provider configuration…")}</p>}
      {config.isError && <p role="alert" className="text-sm text-red-600">{t("Could not load identity provider configuration.")}</p>}
      {config.data?.oauth_enabled && (
        <a className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800" href="/api/v1/auth/oauth/login">
          {t("Continue with")} {config.data.oauth_provider_name}
        </a>
      )}
      {config.data && !config.data.oauth_enabled && (
        <p role="alert" className="text-sm text-red-600">{t("Identity provider sign-in is not configured on this server.")}</p>
      )}
    </main>
  );
}
