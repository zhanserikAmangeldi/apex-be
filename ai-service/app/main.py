import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI

from app.config import settings
from app.database import init_db, close_db
from app.embeddings import get_model
from app.models import HealthResponse
from app.routes.semantic import router as semantic_router
from app.routes.chat import router as chat_router
from app.routes.embeddings import router as embeddings_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("ai-service")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"Starting AI Service (env={settings.env})")
    await init_db()
    get_model()
    logger.info("AI Service ready")
    yield
    await close_db()
    logger.info("AI Service stopped")


app = FastAPI(
    title="Apex AI Service",
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(semantic_router)
app.include_router(chat_router)
app.include_router(embeddings_router, prefix="/api/v1")


@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        status="healthy",
        service="ai-service",
        model_loaded=get_model() is not None,
        timestamp=datetime.now(timezone.utc),
    )
