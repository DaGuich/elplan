from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")
    APP_NAME: str = "elplan"
    ENV: str = "dev"
    DATABASE_URL: str = "postgresql+psycopg://elplan:elplan@localhost:5432/elplan"
    SECRET_KEY: str = "dev-insecure-change-me-0123456789abcdef"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 12
    # Generic OAuth2/OIDC (back-channel authorization code flow). Enabled when OAUTH_CLIENT_ID is set.
    OAUTH_CLIENT_ID: str = ""
    OAUTH_CLIENT_SECRET: str = ""
    # OIDC discovery document, e.g. https://authentik.example.com/application/o/elplan/.well-known/openid-configuration
    OAUTH_DISCOVERY_URL: str = ""
    # Explicit endpoints; override/replace discovery.
    OAUTH_AUTHORIZE_URL: str = ""
    OAUTH_TOKEN_URL: str = ""
    OAUTH_USERINFO_URL: str = ""
    OAUTH_SCOPES: str = "openid email profile"
    # Must match the redirect URI registered at the provider.
    OAUTH_REDIRECT_URI: str = "http://localhost:8080/api/v1/auth/oauth/callback"
    OAUTH_PROVIDER_NAME: str = "SSO"
    # Link to an existing local account with the same email even if the provider does not
    # flag the email as verified. Only enable for providers that verify emails.
    OAUTH_TRUST_EMAIL: bool = False
    # Where the browser is sent after login (token is passed in the URL fragment).
    FRONTEND_URL: str = "http://localhost:8080"
    CORS_ORIGINS: str = "http://localhost:8080"

    @property
    def oauth_enabled(self) -> bool:
        return bool(self.OAUTH_CLIENT_ID)


settings = Settings()
