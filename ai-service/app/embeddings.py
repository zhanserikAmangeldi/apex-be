import hashlib
import logging
import numpy as np
from sentence_transformers import SentenceTransformer
from app.config import settings

logger = logging.getLogger("ai-service")

_model: SentenceTransformer | None = None


def get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        logger.info(f"Loading model: {settings.embedding_model}")
        _model = SentenceTransformer(settings.embedding_model)
        logger.info("Model loaded")
    return _model


def generate_embedding(text: str) -> list[float]:
    """Generate embedding vector for a text string."""
    model = get_model()
    embedding = model.encode(text, normalize_embeddings=True)
    return embedding.tolist()


def generate_embeddings_batch(texts: list[str]) -> list[list[float]]:
    """Generate embeddings for multiple texts at once."""
    model = get_model()
    embeddings = model.encode(texts, normalize_embeddings=True, batch_size=32)
    return [e.tolist() for e in embeddings]


def content_hash(text: str) -> str:
    """SHA-256 hash of content to detect changes."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
