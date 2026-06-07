from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    pricing_source: str = "mock"
    oracle_key_path: str = "oracle_key.json"
    cc_base_url: str = "https://api.collectorcrypt.com"
    pricing_cache_ttl: int = 120


def get_settings() -> Settings:
    return Settings()
