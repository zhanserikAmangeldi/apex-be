from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime


# --- Requests ---

class EmbedRequest(BaseModel):
    document_id: UUID
    vault_id: UUID
    title: str = ""
    content: str


class SemanticSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=2000)
    vault_id: UUID
    limit: int = Field(default=10, ge=1, le=50)
    min_score: float = Field(default=0.35, ge=0.0, le=1.0)


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


# --- Chat Models ---

class ChatMessage(BaseModel):
    role: str  # 'user', 'assistant', 'system'
    content: str
    metadata: dict = {}


class ChatRequest(BaseModel):
    document_id: UUID
    message: str = Field(..., min_length=1, max_length=5000)
    session_id: UUID | None = None
    include_videos: bool = True


class ChatResponse(BaseModel):
    session_id: UUID
    message: ChatMessage
    videos: list["VideoResult"] = []


class ChatSession(BaseModel):
    id: UUID
    document_id: UUID
    title: str
    created_at: datetime
    updated_at: datetime
    messages: list[ChatMessage] = []


# --- Video Models ---

class VideoResult(BaseModel):
    video_id: str
    title: str
    description: str
    thumbnail_url: str
    channel_title: str
    published_at: str
    duration: str | None = None
    view_count: int | None = None


class VideoSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=500)
    max_results: int = Field(default=5, ge=1, le=20)


class VideoSearchResponse(BaseModel):
    query: str
    videos: list[VideoResult]
    count: int
