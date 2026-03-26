from pathlib import Path

from pydantic_settings import BaseSettings

_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    # Supabase
    supabase_url: str = ""
    supabase_service_role_key: str = ""

    # Clerk
    clerk_publishable_key: str = ""
    clerk_secret_key: str = ""

    # CORS
    cors_origins: str = "http://localhost:3000"

    # OpenAI
    openai_api_key: str = ""

    # Database
    database_url: str = ""
    direct_url: str = ""

    # Processing thresholds
    fuzzy_match_threshold: float = 0.92
    classification_confidence_threshold: float = 0.70

    model_config = {"env_file": str(_ENV_FILE), "env_file_encoding": "utf-8"}

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
