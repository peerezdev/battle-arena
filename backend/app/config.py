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
    # Host público de metadata/imágenes de Collector Crypt por mint (keyless). Devnet por defecto;
    # en mainnet: https://nft.collectorcrypt.com. env: CC_NFT_BASE_URL
    cc_nft_base_url: str = "https://nft-dev.collectorcrypt.com"
    privy_app_id: str = ""
    privy_jwks_url: str = "https://auth.privy.io/api/v1/apps/{app_id}/jwks.json"
    privy_app_secret: str = ""
    privy_auth_key: str = ""
    privy_solana_caip2: str = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"  # devnet default
    privy_quorum_id: str = ""
    cc_usdc_mint: str = "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr"
    gimmighoul_per_usdc: float = 1.0  # battles/royale loyalty rate; env: GIMMIGHOUL_PER_USDC
    gimmighoul_per_usdc_gacha: float = 0.5  # gacha loyalty rate (half of battles); env: GIMMIGHOUL_PER_USDC_GACHA
    privy_operator_wallet_id: str = ""
    privy_operator_address: str = ""
    escrow_seed_lamports: int = 10_000_000
    # Endpoints SOLO de desarrollo/test (p.ej. /pack-battles/{id}/join-bot, que mete un bot
    # financiado en un lobby SIN autenticación y mueve USDC on-chain). Deshabilitados por
    # defecto: en producción NUNCA deben estar activos. env: DEV_ENDPOINTS_ENABLED=true
    dev_endpoints_enabled: bool = False
    # Anti-abuso de retiros: el operador paga el gas y la renta de la ATA destino de cada
    # withdraw. Sin un mínimo + rate-limit, un atacante haría miles de retiros de 1 unidad a
    # direcciones nuevas para drenar el SOL del operador (renta de ATA ~0.002 SOL c/u).
    min_withdraw_usdc: float = 1.0        # retiro mínimo (USDC); env: MIN_WITHDRAW_USDC
    withdraw_rate_limit: int = 5          # nº máx. de retiros por wallet y ventana
    withdraw_rate_window_s: float = 60.0  # ventana del rate-limit de retiros (segundos)


def get_settings() -> Settings:
    return Settings()
