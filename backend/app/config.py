from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: str = "sqlite:///battlearena.db"
    chain_source: str = "mock"
    solana_rpc_url: str = "https://api.devnet.solana.com"
    program_id: str = ""
    elo_start: int = 1200
    elo_k: int = 32
    session_ttl: int = 3600
    cors_origins: List[str] = []
    gacha_base_url: str = "https://dev-gacha.collectorcrypt.com"  # vacío => gacha deshabilitado (kill-switch)
    gacha_api_key: str = ""  # opcional; devnet es keyless, solo necesario si el entorno lo exige (p.ej. mainnet)
    privy_app_id: str = ""
    privy_jwks_url: str = "https://auth.privy.io/api/v1/apps/{app_id}/jwks.json"
    privy_app_secret: str = ""
    privy_auth_key: str = ""
    privy_solana_caip2: str = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"  # devnet default
    privy_quorum_id: str = ""
    cc_usdc_mint: str = "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr"
    privy_operator_wallet_id: str = ""
    privy_operator_address: str = ""
    escrow_seed_lamports: int = 10_000_000


def get_settings() -> Settings:
    return Settings()
