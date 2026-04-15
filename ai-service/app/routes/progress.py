import logging
from uuid import UUID
from datetime import datetime, timezone

from fastapi import APIRouter, Request
from pgvector.asyncpg import register_vector
import numpy as np

from app.auth import get_user_from_headers
from app.database import get_pool
from app.models import (
    ProgressDashboardResponse,
    TopicProgress,
    AdaptiveRecommendation,
    RecommendedNote,
)

logger = logging.getLogger("ai-service")
router = APIRouter(prefix="/api/v1", tags=["progress"])

STRONG_THRESHOLD = 0.75
REVIEW_THRESHOLD = 0.50


@router.get("/progress/{vault_id}", response_model=ProgressDashboardResponse)
async def get_progress_dashboard(vault_id: UUID, request: Request):
    """Get full progress dashboard with topic stats and adaptive recommendations."""
    user = get_user_from_headers(request)
    user_id = UUID(user["user_id"])

    pool = get_pool()
    async with pool.acquire() as conn:
        await register_vector(conn)

        # --- Topic progress from quiz results ---
        topic_rows = await conn.fetch(
            """SELECT
                 de.title AS topic,
                 COUNT(*) AS attempts,
                 SUM(CASE WHEN qr.correct THEN 1 ELSE 0 END) AS correct,
                 SUM(qr.xp) AS xp
               FROM quiz_results qr
               JOIN document_embeddings de
                 ON de.document_id = qr.document_id AND de.user_id = qr.user_id
               WHERE qr.user_id = $1 AND qr.vault_id = $2
               GROUP BY de.title
               ORDER BY COUNT(*) DESC""",
            user_id, vault_id,
        )

        # --- Total XP ---
        total_xp = await conn.fetchval(
            "SELECT COALESCE(SUM(xp), 0) FROM quiz_results WHERE user_id = $1 AND vault_id = $2",
            user_id, vault_id,
        ) or 0

        # --- Total reviews (flashcard reviews) ---
        total_reviews = await conn.fetchval(
            """SELECT COALESCE(SUM(reps), 0) FROM flashcards
               WHERE user_id = $1 AND vault_id = $2""",
            user_id, vault_id,
        ) or 0

        # --- Cards due ---
        cards_due = await conn.fetchval(
            """SELECT COUNT(*) FROM flashcards
               WHERE user_id = $1 AND vault_id = $2
                 AND next_review <= $3""",
            user_id, vault_id, datetime.now(timezone.utc),
        ) or 0

        # --- Build topic progress ---
        topic_progress = []
        weak_topics = []
        for row in topic_rows:
            attempts = row["attempts"]
            correct = row["correct"]
            accuracy = correct / attempts if attempts > 0 else 0.0
            xp = row["xp"]

            if accuracy >= STRONG_THRESHOLD:
                status = "strong"
            elif accuracy >= REVIEW_THRESHOLD:
                status = "review"
            else:
                status = "weak"
                weak_topics.append(row["topic"])

            topic_progress.append(TopicProgress(
                topic=row["topic"],
                attempts=attempts,
                correct=correct,
                accuracy=round(accuracy, 3),
                xp=xp,
                status=status,
            ))

        # --- Adaptive recommendations for weak topics ---
        recommendations = []
        if weak_topics:
            all_docs = await conn.fetch(
                """SELECT document_id, title, embedding
                   FROM document_embeddings
                   WHERE vault_id = $1 AND user_id = $2""",
                vault_id, user_id,
            )

            if all_docs:
                doc_ids = [r["document_id"] for r in all_docs]
                doc_titles = [r["title"] for r in all_docs]
                embeddings = np.array([r["embedding"] for r in all_docs])
                norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
                norms[norms == 0] = 1
                embeddings = embeddings / norms

                for weak_title in weak_topics[:5]:
                    # Find the weak document's embedding
                    weak_idx = None
                    for i, t in enumerate(doc_titles):
                        if t == weak_title:
                            weak_idx = i
                            break

                    if weak_idx is None:
                        continue

                    # Find related notes (excluding self)
                    sims = embeddings @ embeddings[weak_idx]
                    sims[weak_idx] = -1

                    top_indices = sims.argsort()[::-1][:3]
                    related = [
                        RecommendedNote(
                            document_id=doc_ids[i],
                            title=doc_titles[i],
                            score=round(float(sims[i]), 3),
                        )
                        for i in top_indices
                    ]

                    # Find accuracy for this topic
                    acc = 0.0
                    for tp in topic_progress:
                        if tp.topic == weak_title:
                            acc = tp.accuracy
                            break

                    recommendations.append(AdaptiveRecommendation(
                        topic=weak_title,
                        accuracy=acc,
                        related_notes=related,
                    ))

    return ProgressDashboardResponse(
        topic_progress=topic_progress,
        total_xp=total_xp,
        total_reviews=total_reviews,
        cards_due=cards_due,
        recommendations=recommendations,
    )
