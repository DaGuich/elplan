from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")
    APP_NAME: str = "elplan"
    ENV: str = "dev"
    DATABASE_URL: str = "postgresql+psycopg://elplan:elplan@localhost:5432/elplan"
    SECRET_KEY: str = "dev-insecure-change-me-0123456789abcdef"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 12
    CORS_ORIGINS: str = "http://localhost:8080"


settings = Settings()
