from fastapi import FastAPI
from app.routes import scraper, sessions
from app.config import settings

app = FastAPI(title="Content Scraper Service")

app.include_router(scraper.router, prefix="/api/v1", tags=["scraper"])
app.include_router(sessions.router, prefix="/api/v1", tags=["sessions"])

@app.get("/health")
async def health():
    return {"status": "healthy"}
