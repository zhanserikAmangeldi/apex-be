from uuid import UUID
from fastapi import APIRouter, Request, HTTPException
from pgvector.asyncpg import register_vector

from app.auth import get_user_from_headers
from app.database import get_pool
from app.embeddings import generate_embedding, generate_embeddings_batch, content_hash
from app.models import (
    EmbedRequest,
    EmbeddingResponse,
    SemanticSearchRequest,
    SemanticSearchResponse,
    SearchResult,
    BatchEmbedRequest,
)
import numpy as np
from sklearn.cluster import KMeans

router = APIRouter(prefix="/api/v1", tags=["semantic"])


@router.post("/embeddings", response_model=EmbeddingResponse)
async def create_embedding(body: EmbedRequest, request: Request):
    """Generate and store embedding for a document."""
    user = get_user_from_headers(request)
    user_id = user["user_id"]

    text = f"{body.title} {body.content}".strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty content")

    c_hash = content_hash(text)

    pool = get_pool()
    async with pool.acquire() as conn:
        await register_vector(conn)

        # Check if embedding exists and content hasn't changed
        existing = await conn.fetchrow(
            "SELECT content_hash FROM document_embeddings WHERE document_id = $1",
            body.document_id,
        )

        if existing and existing["content_hash"] == c_hash:
            return EmbeddingResponse(
                document_id=body.document_id, created=False, content_hash=c_hash
            )

        embedding = generate_embedding(text)

        if existing:
            await conn.execute(
                """UPDATE document_embeddings
                   SET embedding = $1, content_hash = $2, title = $3,
                       user_id = $4, updated_at = CURRENT_TIMESTAMP
                   WHERE document_id = $5""",
                embedding, c_hash, body.title, UUID(user_id), body.document_id,
            )
        else:
            await conn.execute(
                """INSERT INTO document_embeddings
                   (document_id, user_id, title, content_hash, embedding)
                   VALUES ($1, $2, $3, $4, $5)""",
                body.document_id, UUID(user_id), body.title, c_hash, embedding,
            )

    return EmbeddingResponse(
        document_id=body.document_id, created=True, content_hash=c_hash
    )


@router.post("/embeddings/batch", response_model=list[EmbeddingResponse])
async def create_embeddings_batch(body: BatchEmbedRequest, request: Request):
    """Generate and store embeddings for multiple documents."""
    user = get_user_from_headers(request)
    user_id = UUID(user["user_id"])

    results = []
    texts = []
    valid_docs = []

    for doc in body.documents:
        text = f"{doc.title} {doc.content}".strip()
        if text:
            texts.append(text)
            valid_docs.append(doc)

    if not texts:
        return []

    embeddings = generate_embeddings_batch(texts)
    hashes = [content_hash(t) for t in texts]

    pool = get_pool()
    async with pool.acquire() as conn:
        await register_vector(conn)

        for doc, emb, c_hash in zip(valid_docs, embeddings, hashes):
            existing = await conn.fetchrow(
                "SELECT content_hash FROM document_embeddings WHERE document_id = $1",
                doc.document_id,
            )

            if existing and existing["content_hash"] == c_hash:
                results.append(EmbeddingResponse(
                    document_id=doc.document_id, created=False, content_hash=c_hash
                ))
                continue

            if existing:
                await conn.execute(
                    """UPDATE document_embeddings
                       SET embedding = $1, content_hash = $2, title = $3,
                           user_id = $4, updated_at = CURRENT_TIMESTAMP
                       WHERE document_id = $5""",
                    emb, c_hash, doc.title, user_id, doc.document_id,
                )
            else:
                await conn.execute(
                    """INSERT INTO document_embeddings
                       (document_id, user_id, title, content_hash, embedding)
                       VALUES ($1, $2, $3, $4, $5)""",
                    doc.document_id, user_id, doc.title, c_hash, emb,
                )

            results.append(EmbeddingResponse(
                document_id=doc.document_id, created=True, content_hash=c_hash
            ))

    return results


@router.post("/search/semantic", response_model=SemanticSearchResponse)
async def semantic_search(body: SemanticSearchRequest, request: Request):
    """Search documents by semantic similarity."""
    user = get_user_from_headers(request)
    user_id = user["user_id"]

    query_embedding = generate_embedding(body.query)

    pool = get_pool()
    async with pool.acquire() as conn:
        await register_vector(conn)

        rows = await conn.fetch(
            """SELECT document_id, title,
                      1 - (embedding <=> $1::vector) AS score
               FROM document_embeddings
               WHERE user_id = $2
               ORDER BY embedding <=> $1::vector
               LIMIT $3""",
            query_embedding, UUID(user_id), body.limit,
        )

    results = [
        SearchResult(
            document_id=row["document_id"],
            title=row["title"] or "",
            score=round(float(row["score"]), 4),
        )
        for row in rows
        if float(row["score"]) >= body.min_score
    ]

    return SemanticSearchResponse(
        query=body.query, results=results, count=len(results)
    )


@router.get("/embeddings/{document_id}/related", response_model=list[SearchResult])
async def get_related_documents(document_id: UUID, request: Request, limit: int = 5):
    """Find documents similar to a given document."""
    user = get_user_from_headers(request)
    user_id = user["user_id"]

    pool = get_pool()
    async with pool.acquire() as conn:
        await register_vector(conn)

        # Get the source document's embedding
        source = await conn.fetchrow(
            "SELECT embedding FROM document_embeddings WHERE document_id = $1",
            document_id,
        )
        if not source:
            raise HTTPException(status_code=404, detail="Document embedding not found")

        rows = await conn.fetch(
            """SELECT document_id, title,
                      1 - (embedding <=> $1::vector) AS score
               FROM document_embeddings
               WHERE user_id = $2 AND document_id != $3
               ORDER BY embedding <=> $1::vector
               LIMIT $4""",
            source["embedding"], UUID(user_id), document_id, limit,
        )

    return [
        SearchResult(
            document_id=row["document_id"],
            title=row["title"] or "",
            score=round(float(row["score"]), 4),
        )
        for row in rows
    ]


@router.delete("/embeddings/{document_id}")
async def delete_embedding(document_id: UUID, request: Request):
    """Delete embedding when document is deleted."""
    user = get_user_from_headers(request)

    pool = get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM document_embeddings WHERE document_id = $1",
            document_id,
        )

    deleted = result.split()[-1] != "0"
    return {"deleted": deleted, "document_id": str(document_id)}


@router.get("/topics/clusters")
async def get_topic_clusters(request: Request, k: int = 0):
    """Cluster user's documents by topic using k-means on embeddings."""
    user = get_user_from_headers(request)
    user_id = user["user_id"]

    pool = get_pool()
    async with pool.acquire() as conn:
        await register_vector(conn)

        rows = await conn.fetch(
            """SELECT document_id, title, embedding
               FROM document_embeddings
               WHERE user_id = $1""",
            UUID(user_id),
        )

    if len(rows) < 2:
        return {"clusters": [], "count": 0}

    doc_ids = [str(row["document_id"]) for row in rows]
    titles = [row["title"] or "" for row in rows]
    embeddings = np.array([list(row["embedding"]) for row in rows])

    # Auto-determine k if not provided (sqrt heuristic, min 2, max 8)
    n = len(rows)
    if k <= 0:
        k = max(2, min(8, int(n ** 0.5)))
    k = min(k, n)

    kmeans = KMeans(n_clusters=k, random_state=42, n_init=10)
    labels = kmeans.fit_predict(embeddings)

    # Build cluster response
    # Palette of distinct colors for clusters
    palette = [
        "#8b5cf6", "#f59e0b", "#10b981", "#ef4444",
        "#3b82f6", "#ec4899", "#14b8a6", "#f97316",
    ]

    clusters = {}
    for i, label in enumerate(labels):
        label = int(label)
        if label not in clusters:
            clusters[label] = {
                "cluster_id": label,
                "color": palette[label % len(palette)],
                "documents": [],
            }
        clusters[label]["documents"].append({
            "document_id": doc_ids[i],
            "title": titles[i],
        })

    return {
        "clusters": list(clusters.values()),
        "count": len(clusters),
    }
