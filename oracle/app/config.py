from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    pricing_source: str = "mock"
    oracle_key_path: str = "oracle_key.json"
    cc_base_url: str = "https://api.collectorcrypt.com"
    pricing_cache_ttl: int = 120
    rate_limit_per_min: int = 30
    cors_origins: list[str] = []

    @field_validator("cc_base_url")
    @classmethod
    def _require_https(cls, v: str) -> str:
        if v.startswith("https://"):
            return v
        if v.startswith("http://localhost") or v.startswith("http://127.0.0.1"):
            return v
        raise ValueError(
            "cc_base_url must use https:// (http://localhost and http://127.0.0.1 allowed for dev)"
        )


def get_settings() -> Settings:
    return Settings()
