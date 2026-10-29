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

    # Blueprint/asset storage: "filesystem" (STORAGE_LOCAL_ROOT) or "s3" (AWS S3, MinIO, Ceph).
    STORAGE_BACKEND: str = "filesystem"
    STORAGE_LOCAL_ROOT: str = "./data/uploads"
    STORAGE_MAX_UPLOAD_BYTES: int = 25 * 1024 * 1024
    S3_BUCKET: str = ""
    S3_PREFIX: str = ""
    S3_ENDPOINT_URL: str = ""
    S3_REGION: str = ""
    S3_ACCESS_KEY_ID: str = ""
    S3_SECRET_ACCESS_KEY: str = ""
    # "path" is usually required for MinIO/Ceph.
    S3_ADDRESSING_STYLE: str = "auto"
    # Redirect downloads to presigned URLs instead of streaming through the backend.
    S3_PRESIGN_DOWNLOADS: bool = False
    S3_PRESIGN_EXPIRES_SECONDS: int = 300

    @property
    def oauth_enabled(self) -> bool:
        return bool(self.OAUTH_CLIENT_ID)


settings = Settings()
