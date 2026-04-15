import asyncio
import json
import logging
from uuid import UUID
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Request, HTTPException
from pgvector.asyncpg import register_vector

from app.auth import get_user_from_headers
from app.config import settings
from app.database import get_pool
from app.chat import get_chat_client
from app.models import (
    ChatMessage,
    FlashcardGenerateRequest,
    FlashcardGenerateResponse,
    FlashcardVaultGenerateResponse,
    Flashcard,
    FlashcardReviewRequest,
    FlashcardReviewResponse,
    FlashcardListResponse,
)
from app.sm2 import sm2_review

logger = logging.getLogger("ai-service")
router = APIRouter(prefix="/api/v1", tags=["flashcards"])


FLASHCARD_PROMPT = """Analyze the following study note and generate flashcards for spaced repetition.

TITLE: {title}

CONTENT:
{content}

Generate 3-7 flashcards as a JSON array. Each flashcard should have:
- "front": a clear question or prompt
- "back": a concise, accurate answer

Focus on key concepts, definitions, and relationships.
Return ONLY a JSON array, no other text:
[{{"front": "...", "back": "..."}}, ...]"""


@router.post("/flashcards/generate", response_model=FlashcardGenerateResponse)
async def generate_flashcards(body: FlashcardGenerateRequest, request: Request):
    """Generate flashcards from document content using LLM."""
    user = get_user_from_headers(request)
    user_id = UUID(user["user_id"])

    chat_client = get_chat_client()
    prompt = FLASHCARD_PROMPT.format(
        title=body.title,
        content=body.content[:3000],
    )

    try:
        response = await chat_client.generate_response(
            messages=[ChatMessage(role="user", content=prompt)],
        )
    except Exception as e:
        logger.error(f"LLM flashcard generation failed: {e}")
        raise HTTPException(status_code=502, detail="Failed to generate flashcards")

    # Parse LLM response
    try:
        json_match = response.strip()
        if json_match.startswith("```"):
            json_match = json_match.split("```")[1]
            if json_match.startswith("json"):
                json_match = json_match[4:]
        raw_cards = json.loads(json_match)
    except (json.JSONDecodeError, IndexError):
        logger.error(f"Failed to parse LLM flashcard response: {response[:200]}")
        raise HTTPException(status_code=502, detail="Failed to parse generated flashcards")

    if not isinstance(raw_cards, list) or len(raw_cards) == 0:
        raise HTTPException(status_code=502, detail="No flashcards generated")

    pool = get_pool()
    cards = []
    async with pool.acquire() as conn:
        for rc in raw_cards[:10]:  # cap at 10
            front = rc.get("front", "").strip()
            back = rc.get("back", "").strip()
            if not front or not back:
                continue

            row = await conn.fetchrow(
                """INSERT INTO flashcards
                   (user_id, document_id, vault_id, front, back)
                   VALUES ($1, $2, $3, $4, $5)
                   RETURNING *""",
                user_id, body.document_id, body.vault_id, front, back,
            )
            cards.append(_row_to_flashcard(row))

    return FlashcardGenerateResponse(
        document_id=body.document_id,
        cards=cards,
        count=len(cards),
    )


async def _fetch_document_content(document_id: UUID, access_token: str) -> str:
    """Fetch document text content from editor-service."""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{settings.editor_service_url}/api/v1/documents/{document_id}/export/text",
                headers={"Authorization": f"Bearer {access_token}"},
                timeout=15.0,
            )
            if response.status_code == 200:
                data = response.json()
                return data.get("content", "")
    except Exception as e:
        logger.warning(f"Failed to fetch document {document_id}: {e}")
    return ""


async def _generate_cards_for_document(
    chat_client,
    user_id: UUID,
    document_id: UUID,
    vault_id: UUID,
    title: str,
    content: str,
    conn,
) -> list[Flashcard]:
    """Generate and persist flashcards for a single document. Returns created cards."""
    if not content or len(content.strip()) < 30:
        return []

    # Skip if cards already exist for this document
    existing = await conn.fetchval(
        "SELECT COUNT(*) FROM flashcards WHERE user_id = $1 AND document_id = $2",
        user_id, document_id,
    )
    if existing > 0:
        return []

    prompt = FLASHCARD_PROMPT.format(title=title, content=content[:3000])

    try:
        response = await chat_client.generate_response(
            messages=[ChatMessage(role="user", content=prompt)],
        )
    except Exception as e:
        logger.warning(f"LLM failed for document {document_id}: {e}")
        return []

    try:
        json_match = response.strip()
        if json_match.startswith("```"):
            json_match = json_match.split("```")[1]
            if json_match.startswith("json"):
                json_match = json_match[4:]
        raw_cards = json.loads(json_match)
    except (json.JSONDecodeError, IndexError):
        logger.warning(f"Failed to parse flashcards for {document_id}")
        return []

    if not isinstance(raw_cards, list):
        return []

    cards = []
    for rc in raw_cards[:10]:
        front = rc.get("front", "").strip()
        back = rc.get("back", "").strip()
        if not front or not back:
            continue
        row = await conn.fetchrow(
            """INSERT INTO flashcards
               (user_id, document_id, vault_id, front, back)
               VALUES ($1, $2, $3, $4, $5)
               RETURNING *""",
            user_id, document_id, vault_id, front, back,
        )
        cards.append(_row_to_flashcard(row))
    return cards


@router.post("/flashcards/generate/vault/{vault_id}", response_model=FlashcardVaultGenerateResponse)
async def generate_flashcards_for_vault(vault_id: UUID, request: Request):
    """Generate flashcards for ALL documents in a vault.
    Skips documents that already have flashcards.
    """
    user = get_user_from_headers(request)
    user_id = UUID(user["user_id"])

    auth_header = request.headers.get("Authorization", "")
    access_token = auth_header.replace("Bearer ", "") if auth_header else ""

    pool = get_pool()
    chat_client = get_chat_client()

    async with pool.acquire() as conn:
        # Get all indexed documents in this vault
        doc_rows = await conn.fetch(
            """SELECT document_id, title
               FROM document_embeddings
               WHERE vault_id = $1 AND user_id = $2""",
            vault_id, user_id,
        )

    if not doc_rows:
        raise HTTPException(status_code=400, detail="No indexed documents found in this vault")

    # Check which documents already have flashcards
    async with pool.acquire() as conn:
        existing_docs = await conn.fetch(
            """SELECT DISTINCT document_id FROM flashcards
               WHERE user_id = $1 AND vault_id = $2""",
            user_id, vault_id,
        )
    existing_set = {r["document_id"] for r in existing_docs}

    # Filter to only new documents
    new_docs = [d for d in doc_rows if d["document_id"] not in existing_set]
    skipped = len(doc_rows) - len(new_docs)

    if not new_docs:
        return FlashcardVaultGenerateResponse(
            vault_id=vault_id, cards=[], total_cards=0,
            documents_processed=0, documents_skipped=skipped,
        )

    # Fetch all contents in parallel
    content_tasks = [
        _fetch_document_content(d["document_id"], access_token)
        for d in new_docs
    ]
    contents = await asyncio.gather(*content_tasks)

    # Generate flashcards via LLM in parallel
    async def _gen_llm(title: str, content: str) -> list[dict]:
        if not content or len(content.strip()) < 30:
            return []
        prompt = FLASHCARD_PROMPT.format(title=title, content=content[:3000])
        try:
            response = await chat_client.generate_response(
                messages=[ChatMessage(role="user", content=prompt)],
            )
        except Exception as e:
            logger.warning(f"LLM flashcard gen failed for {title}: {e}")
            return []
        try:
            text = response.strip()
            if text.startswith("```"):
                text = text.split("```")[1]
                if text.startswith("json"):
                    text = text[4:]
            raw = json.loads(text)
            return raw if isinstance(raw, list) else []
        except (json.JSONDecodeError, IndexError):
            return []

    llm_tasks = [
        _gen_llm(d["title"], contents[i])
        for i, d in enumerate(new_docs)
    ]
    llm_results = await asyncio.gather(*llm_tasks)

    # Insert cards sequentially (DB writes)
    all_cards: list[Flashcard] = []
    processed = 0

    async with pool.acquire() as conn:
        for i, raw_cards in enumerate(llm_results):
            if not raw_cards:
                skipped += 1
                continue
            doc_id = new_docs[i]["document_id"]
            for rc in raw_cards[:10]:
                front = rc.get("front", "").strip()
                back = rc.get("back", "").strip()
                if not front or not back:
                    continue
                row = await conn.fetchrow(
                    """INSERT INTO flashcards
                       (user_id, document_id, vault_id, front, back)
                       VALUES ($1, $2, $3, $4, $5)
                       RETURNING *""",
                    user_id, doc_id, vault_id, front, back,
                )
                all_cards.append(_row_to_flashcard(row))
            processed += 1

    return FlashcardVaultGenerateResponse(
        vault_id=vault_id,
        cards=all_cards,
        total_cards=len(all_cards),
        documents_processed=processed,
        documents_skipped=skipped,
    )


@router.get("/flashcards/{vault_id}", response_model=FlashcardListResponse)
async def list_flashcards(vault_id: UUID, request: Request, due_only: bool = False):
    """List flashcards for a vault, optionally only due cards."""
    user = get_user_from_headers(request)
    user_id = UUID(user["user_id"])

    pool = get_pool()
    async with pool.acquire() as conn:
        if due_only:
            rows = await conn.fetch(
                """SELECT * FROM flashcards
                   WHERE user_id = $1 AND vault_id = $2
                     AND next_review <= $3
                   ORDER BY next_review ASC""",
                user_id, vault_id, datetime.now(timezone.utc),
            )
        else:
            rows = await conn.fetch(
                """SELECT * FROM flashcards
                   WHERE user_id = $1 AND vault_id = $2
                   ORDER BY created_at DESC""",
                user_id, vault_id,
            )

        due_count = await conn.fetchval(
            """SELECT COUNT(*) FROM flashcards
               WHERE user_id = $1 AND vault_id = $2
                 AND next_review <= $3""",
            user_id, vault_id, datetime.now(timezone.utc),
        )

    cards = [_row_to_flashcard(r) for r in rows]
    return FlashcardListResponse(cards=cards, total=len(cards), due=due_count)


@router.post("/flashcards/{card_id}/review", response_model=FlashcardReviewResponse)
async def review_flashcard(card_id: UUID, body: FlashcardReviewRequest, request: Request):
    """Submit a review for a flashcard (SM-2 algorithm)."""
    user = get_user_from_headers(request)
    user_id = UUID(user["user_id"])

    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM flashcards WHERE id = $1 AND user_id = $2",
            card_id, user_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Flashcard not found")

        new_ef, new_interval, new_reps, new_next = sm2_review(
            quality=body.quality,
            ease_factor=row["ease_factor"],
            interval=row["interval_days"],
            reps=row["reps"],
        )

        await conn.execute(
            """UPDATE flashcards
               SET ease_factor = $1, interval_days = $2, reps = $3,
                   next_review = $4, updated_at = CURRENT_TIMESTAMP
               WHERE id = $5""",
            new_ef, new_interval, new_reps, new_next, card_id,
        )

    return FlashcardReviewResponse(
        id=card_id,
        ease_factor=round(new_ef, 2),
        interval_days=new_interval,
        reps=new_reps,
        next_review=new_next,
    )


@router.delete("/flashcards/{card_id}")
async def delete_flashcard(card_id: UUID, request: Request):
    """Delete a flashcard."""
    user = get_user_from_headers(request)
    user_id = UUID(user["user_id"])

    pool = get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM flashcards WHERE id = $1 AND user_id = $2",
            card_id, user_id,
        )
        if result == "DELETE 0":
            raise HTTPException(status_code=404, detail="Flashcard not found")

    return {"deleted": True}


def _row_to_flashcard(row) -> Flashcard:
    return Flashcard(
        id=row["id"],
        document_id=row["document_id"],
        vault_id=row["vault_id"],
        front=row["front"],
        back=row["back"],
        ease_factor=row["ease_factor"],
        interval_days=row["interval_days"],
        reps=row["reps"],
        next_review=row["next_review"],
        created_at=row["created_at"],
    )
