from fastapi import APIRouter
from pydantic import BaseModel
from typing import List
from app.embeddings import generate_embedding, generate_embeddings_batch

router = APIRouter()

class EmbeddingRequest(BaseModel):
    text: str

class BatchEmbeddingRequest(BaseModel):
    texts: List[str]

class EmbeddingResponse(BaseModel):
    embedding: List[float]

class BatchEmbeddingResponse(BaseModel):
    embeddings: List[List[float]]

@router.post("/embeddings", response_model=EmbeddingResponse)
async def create_embedding(request: EmbeddingRequest):
    embedding = generate_embedding(request.text)
    return EmbeddingResponse(embedding=embedding)

@router.post("/embeddings/batch", response_model=BatchEmbeddingResponse)
async def create_embeddings_batch(request: BatchEmbeddingRequest):
    embeddings = generate_embeddings_batch(request.texts)
    return BatchEmbeddingResponse(embeddings=embeddings)
