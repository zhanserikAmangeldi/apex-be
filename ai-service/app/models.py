from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime


# --- Requests ---

class EmbedRequest(BaseModel):
    document_id: UUID
    title: str = ""
    content: str


class SemanticSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=2000)
    limit: int = Field(default=10, ge=1, le=50)
    min_score: float = Field(default=0.15, ge=0.0, le=1.0)


class BatchEmbedRequest(BaseModel):
    documents: list[EmbedRequest]


# --- Responses ---

class EmbeddingResponse(BaseModel):
    document_id: UUID
    created: bool
    content_hash: str


class SearchResult(BaseModel):
    document_id: UUID
    title: str
    score: float


class SemanticSearchResponse(BaseModel):
    query: str
    results: list[SearchResult]
    count: int


class HealthResponse(BaseModel):
    model_config = {"protected_namespaces": ()}

    status: str
    service: str
    model_loaded: bool
    timestamp: datetime
