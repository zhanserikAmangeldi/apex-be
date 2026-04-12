from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Database
    db_host: str = "ai-postgres"
    db_port: int = 5432
    db_user: str = "ai-service"
    db_password: str = "change-me-in-production"
    db_name: str = "ai_service"
    db_max_connections: int = 10

    # Model
    embedding_model: str = "all-MiniLM-L6-v2"
    embedding_dimension: int = 384

    # Search
    default_search_limit: int = 10
    min_similarity_score: float = 0.15

    # Service
    port: int = 8090
    env: str = "development"

    # Editor service (for fetching document content)
    editor_service_url: str = "http://editor-service:3000"

    # JWT
    jwt_secret: str = "your-super-secret-jwt-key-change-in-production-min-32-chars"

    # YouTube API
    youtube_api_key: str = ""

    # OpenAI (for chat)
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"

    @property
    def database_url(self) -> str:
        return f"postgresql://{self.db_user}:{self.db_password}@{self.db_host}:{self.db_port}/{self.db_name}"

    class Config:
        env_prefix = ""
        case_sensitive = False


settings = Settings()
