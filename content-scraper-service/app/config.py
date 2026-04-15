from pydantic_settings import BaseSettings
from typing import List

class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/scraper_db"
    REDIS_URL: str = "redis://localhost:6379/0"
    
    # Encryption key for storing credentials
    ENCRYPTION_KEY: str
    
    # JWT settings
    JWT_SECRET: str
    JWT_ALGORITHM: str = "HS256"
    
    # CORS
    CORS_ORIGINS: List[str] = ["http://localhost:3000", "chrome-extension://*"]
    
    # Scraping settings
    MAX_CONCURRENT_SCRAPES: int = 5
    SCRAPE_TIMEOUT: int = 30
    USER_AGENT: str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    
    # AI Service URL
    AI_SERVICE_URL: str = "http://ai-service:8090"
    
    # Editor Service URL
    EDITOR_SERVICE_URL: str = "http://editor-service:3000"
    
    class Config:
        env_file = ".env"

settings = Settings()
