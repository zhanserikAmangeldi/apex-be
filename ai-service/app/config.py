from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    db_host: str = "ai-postgres"
    db_port: int = 5432
    db_user: str = "ai-service"
    db_password: str = "change-me-in-production"
    db_name: str = "ai_service"
    db_max_connections: int = 10

    embedding_model: str = "all-MiniLM-L6-v2"
    embedding_dimension: int = 384

    default_search_limit: int = 10
    min_similarity_score: float = 0.15

    port: int = 8090
    env: str = "development"

    editor_service_url: str = "http://editor-service:3000"

    jwt_secret: str = "your-super-secret-jwt-key-change-in-production-min-32-chars"

    youtube_api_key: str = ""
 
    chat_provider: str = "openai"
    
    openai_api_key: str = "deepseek"
    openai_model: str = "gpt-4o-mini"
    openai_base_url: str = "https://api.openai.com/v1"
    
    deepseek_api_key: str = ""
    deepseek_model: str = "deepseek-chat"
    deepseek_base_url: str = "https://api.deepseek.com/v1"

    @property
    def database_url(self) -> str:
        return f"postgresql://{self.db_user}:{self.db_password}@{self.db_host}:{self.db_port}/{self.db_name}"

    class Config:
        env_prefix = ""
        case_sensitive = False


settings = Settings()
