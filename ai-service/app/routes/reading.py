import logging
from uuid import UUID
from datetime import datetime, timezone

from fastapi import APIRouter, Request, HTTPException

from app.auth import get_user_from_headers
from app.database import get_pool
from app.sm2 import sm2_review
from app.models import ReadingItem, ReadingListResponse

logger = logging.getLogger("ai-service")
router = APIRouter(prefix="/api/v1", tags=["reading"])


@router.get("/reading/{vault_id}", response_model=ReadingListResponse)
async def get_reading_list(vault_id: UUID, request: Request):
    """Get notes due for re-reading based on SM-2 schedule + quiz accuracy."""
    user = get_user_from_headers(request)
    user_id = UUID(user["user_id"])
    now = datetime.now(timezone.utc)

    pool = get_pool()
    async with pool.acquire() as conn:
        # Ensure all indexed docs have a reading schedule entry
        await conn.execute(
            """INSERT INTO reading_schedule (user_id, document_id, vault_id)
               SELECT $1, de.document_id, de.vault_id
               FROM document_embeddings de
               WHERE de.vault_id = $2 AND de.user_id = $1
                 AND NOT EXISTS (
                   SELECT 1 FROM reading_schedule rs
                   WHERE rs.user_id = $1 AND rs.document_id = de.document_id
                 )""",
            user_id, vault_id,
        )

        # Get due reading items
        due_rows = await conn.fetch(
            """SELECT rs.document_id, de.title, rs.vault_id,
                      rs.interval_days, rs.next_review, rs.last_read_at
               FROM reading_schedule rs
               JOIN document_embeddings de
                 ON de.document_id = rs.document_id AND de.user_id = rs.user_id
               WHERE rs.user_id = $1 AND rs.vault_id = $2
                 AND rs.next_review <= $3
               ORDER BY rs.next_review ASC
               LIMIT 20""",
            user_id, vault_id, now,
        )

        # Get docs with low quiz accuracy (< 50%)
        weak_rows = await conn.fetch(
            """SELECT de.document_id, de.title,
                      COUNT(*) AS attempts,
                      SUM(CASE WHEN qr.correct THEN 1 ELSE 0 END) AS correct_cnt
               FROM quiz_results qr
               JOIN document_embeddings de
                 ON de.document_id = qr.document_id AND de.user_id = qr.user_id
               WHERE qr.user_id = $1 AND qr.vault_id = $2
               GROUP BY de.document_id, de.title
               HAVING SUM(CASE WHEN qr.correct THEN 1 ELSE 0 END)::float
                      / COUNT(*) < 0.5""",
            user_id, vault_id,
        )

        # Get never-read docs (reps = 0)
        never_rows = await conn.fetch(
            """SELECT rs.document_id, de.title, rs.vault_id,
                      rs.interval_days, rs.next_review, rs.last_read_at
               FROM reading_schedule rs
               JOIN document_embeddings de
                 ON de.document_id = rs.document_id AND de.user_id = rs.user_id
               WHERE rs.user_id = $1 AND rs.vault_id = $2
                 AND rs.reps = 0 AND rs.last_read_at IS NULL
               ORDER BY de.created_at DESC
               LIMIT 5""",
            user_id, vault_id,
        )

    items: list[ReadingItem] = []
    seen = set()

    # Due items
    for r in due_rows:
        did = r["document_id"]
        if did not in seen:
            seen.add(did)
            items.append(ReadingItem(
                document_id=did, title=r["title"], vault_id=r["vault_id"],
                interval_days=r["interval_days"], next_review=r["next_review"],
                last_read_at=r["last_read_at"], reason="due",
            ))

    # Low accuracy items
    for r in weak_rows:
        did = r["document_id"]
        if did not in seen:
            seen.add(did)
            items.append(ReadingItem(
                document_id=did, title=r["title"], vault_id=vault_id,
                interval_days=0, next_review=now,
                last_read_at=None, reason="low_accuracy",
            ))

    # Never read
    for r in never_rows:
        did = r["document_id"]
        if did not in seen:
            seen.add(did)
            items.append(ReadingItem(
                document_id=did, title=r["title"], vault_id=r["vault_id"],
                interval_days=r["interval_days"], next_review=r["next_review"],
                last_read_at=r["last_read_at"], reason="never_read",
            ))

    return ReadingListResponse(items=items, total_due=len(items))


@router.post("/reading/{document_id}/mark-read")
async def mark_as_read(document_id: UUID, request: Request):
    """Mark a document as read, advancing its SM-2 schedule."""
    user = get_user_from_headers(request)
    user_id = UUID(user["user_id"])
    now = datetime.now(timezone.utc)

    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM reading_schedule WHERE user_id = $1 AND document_id = $2",
            user_id, document_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Reading schedule not found")

        new_ef, new_interval, new_reps, new_next = sm2_review(
            quality=4,  # "read" counts as quality=4 (good)
            ease_factor=row["ease_factor"],
            interval=row["interval_days"],
            reps=row["reps"],
        )

        await conn.execute(
            """UPDATE reading_schedule
               SET ease_factor = $1, interval_days = $2, reps = $3,
                   next_review = $4, last_read_at = $5, updated_at = $5
               WHERE user_id = $6 AND document_id = $7""",
            new_ef, new_interval, new_reps, new_next, now, user_id, document_id,
        )

    return {
        "document_id": str(document_id),
        "next_review": new_next.isoformat(),
        "interval_days": new_interval,
    }
