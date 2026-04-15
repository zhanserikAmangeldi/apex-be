import asyncio
import json
import logging
import random
from uuid import UUID

import httpx
from fastapi import APIRouter, Request, HTTPException
from pgvector.asyncpg import register_vector
import numpy as np

from app.auth import get_user_from_headers
from app.config import settings
from app.database import get_pool
from app.chat import get_chat_client
from app.models import (
    ChatMessage,
    QuizGenerateRequest,
    QuizGenerateResponse,
    QuizQuestion,
    QuizOption,
    QuizSubmitRequest,
    QuizSubmitResponse,
    MixedQuizQuestion,
    MixedQuizGenerateResponse,
    MixedQuizSubmitRequest,
    MixedQuizAnswerItem,
)

logger = logging.getLogger("ai-service")
router = APIRouter(prefix="/api/v1", tags=["quiz"])

XP_CORRECT = 20
XP_INCORRECT = 5

QUIZ_PROMPT = """You are a quiz generator for a study platform.

Based on the following note, generate exactly 1 multiple-choice question that tests understanding of the content.

TITLE: {title}

CONTENT:
{content}

Requirements:
- The question must test real understanding, not just title recognition
- Provide exactly 4 options: 1 correct and 3 plausible but wrong
- Wrong options should be related to the topic but clearly incorrect
- Keep the question and options concise

Return ONLY valid JSON, no other text:
{{"question": "...", "correct": "...", "wrong": ["...", "...", "..."]}}"""


async def _fetch_document_content(document_id: UUID, access_token: str) -> str:
    """Fetch document text from editor-service."""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{settings.editor_service_url}/api/v1/documents/{document_id}/export/text",
                headers={"Authorization": f"Bearer {access_token}"},
                timeout=15.0,
            )
            if resp.status_code == 200:
                return resp.json().get("content", "")
            else:
                logger.warning(f"Editor returned {resp.status_code} for doc {document_id}")
    except Exception as e:
        logger.warning(f"Failed to fetch document {document_id}: {e}")
    return ""


async def _generate_question_llm(
    chat_client,
    doc_id: UUID,
    title: str,
    content: str,
) -> dict | None:
    """Use LLM to generate a meaningful question from document content."""
    if not content or len(content.strip()) < 30:
        return None

    prompt = QUIZ_PROMPT.format(title=title, content=content[:2500])

    try:
        response = await chat_client.generate_response(
            messages=[ChatMessage(role="user", content=prompt)],
        )
    except Exception as e:
        logger.warning(f"LLM quiz generation failed for {doc_id}: {e}")
        return None

    try:
        text = response.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        parsed = json.loads(text)
    except (json.JSONDecodeError, IndexError):
        logger.warning(f"Failed to parse quiz JSON for {doc_id}: {response[:200]}")
        return None

    question = parsed.get("question", "").strip()
    correct = parsed.get("correct", "").strip()
    wrong = parsed.get("wrong", [])

    if not question or not correct or not isinstance(wrong, list) or len(wrong) < 3:
        return None

    return {
        "question": question,
        "correct": correct,
        "wrong": [w.strip() for w in wrong[:3]],
    }


def _generate_question_fallback(
    idx: int,
    doc_ids: list[UUID],
    titles: list[str],
    contents: list[str],
    embeddings: np.ndarray,
) -> QuizQuestion | None:
    """Fallback: generate a question from content snippets using embeddings for distractors."""
    content = contents[idx]
    title = titles[idx]

    # Extract a meaningful sentence from content for the clue
    sentences = [s.strip() for s in content.replace("\n", ". ").split(".") if len(s.strip()) > 25]
    if not sentences:
        return None

    clue = sentences[0][:120]

    # Find distractors via cosine similarity
    sims = embeddings @ embeddings[idx]
    sims[idx] = -1
    distractor_indices = sims.argsort()[::-1][:3]

    if len(distractor_indices) < 3:
        return None

    distractor_titles = [titles[i] for i in distractor_indices]
    options_raw = distractor_titles + [title]
    random.shuffle(options_raw)

    options = [
        QuizOption(text=t, is_correct=(t == title))
        for t in options_raw
    ]

    return QuizQuestion(
        document_id=doc_ids[idx],
        question=f"Which note contains this information: \"{clue}...\"?",
        options=options,
        topic=title,
    )


@router.post("/quiz/generate", response_model=QuizGenerateResponse)
async def generate_quiz(body: QuizGenerateRequest, request: Request):
    """Generate a quiz with LLM-powered questions, with embedding-based fallback."""
    user = get_user_from_headers(request)
    user_id = UUID(user["user_id"])

    auth_header = request.headers.get("Authorization", "")
    access_token = auth_header.replace("Bearer ", "") if auth_header else ""

    pool = get_pool()
    async with pool.acquire() as conn:
        await register_vector(conn)

        rows = await conn.fetch(
            """SELECT document_id, title, embedding
               FROM document_embeddings
               WHERE vault_id = $1 AND user_id = $2""",
            body.vault_id, user_id,
        )

    if len(rows) < 2:
        raise HTTPException(
            status_code=400,
            detail=f"Need at least 2 indexed documents, found {len(rows)}",
        )

    doc_ids = [r["document_id"] for r in rows]
    titles = [r["title"] for r in rows]
    embeddings = np.array([r["embedding"] for r in rows])
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    norms[norms == 0] = 1
    embeddings = embeddings / norms

    n = min(body.num_questions, len(rows))
    sampled_indices = random.sample(range(len(rows)), n)

    # Fetch all document contents in parallel
    content_tasks = [
        _fetch_document_content(doc_ids[idx], access_token)
        for idx in sampled_indices
    ]
    contents_list = await asyncio.gather(*content_tasks)
    contents = {idx: content for idx, content in zip(sampled_indices, contents_list)}

    # Generate LLM questions in parallel (max 3 concurrent to avoid rate limits)
    chat_client = get_chat_client()
    sem = asyncio.Semaphore(3)

    async def _gen_one(idx: int) -> QuizQuestion | None:
        async with sem:
            content = contents.get(idx, "")
            result = await _generate_question_llm(chat_client, doc_ids[idx], titles[idx], content)
            if result:
                options_raw = result["wrong"] + [result["correct"]]
                random.shuffle(options_raw)
                options = [
                    QuizOption(text=t, is_correct=(t == result["correct"]))
                    for t in options_raw
                ]
                return QuizQuestion(
                    document_id=doc_ids[idx],
                    question=result["question"],
                    options=options,
                    topic=titles[idx],
                )
            # Fallback
            if content and len(rows) >= 4:
                all_contents = [contents.get(i, "") for i in range(len(rows))]
                return _generate_question_fallback(idx, doc_ids, titles, all_contents, embeddings)
            return None

    question_tasks = [_gen_one(idx) for idx in sampled_indices]
    results = await asyncio.gather(*question_tasks)
    questions = [q for q in results if q is not None]

    if not questions:
        raise HTTPException(
            status_code=502,
            detail="Could not generate any questions. Check that documents have content and AI provider is configured.",
        )

    return QuizGenerateResponse(questions=questions, count=len(questions))


@router.post("/quiz/submit", response_model=QuizSubmitResponse)
async def submit_quiz(body: QuizSubmitRequest, request: Request):
    """Submit quiz answers and track results."""
    user = get_user_from_headers(request)
    user_id = UUID(user["user_id"])

    pool = get_pool()
    total_xp = 0
    correct_count = 0

    async with pool.acquire() as conn:
        for answer in body.answers:
            xp = XP_CORRECT if answer.correct else XP_INCORRECT
            total_xp += xp
            if answer.correct:
                correct_count += 1

            await conn.execute(
                """INSERT INTO quiz_results
                   (user_id, vault_id, document_id, question, correct, xp)
                   VALUES ($1, $2, $3, $4, $5, $6)""",
                user_id, body.vault_id, answer.document_id,
                answer.question, answer.correct, xp,
            )

    total = len(body.answers)
    accuracy = correct_count / total if total > 0 else 0.0

    return QuizSubmitResponse(
        total=total,
        correct=correct_count,
        xp_earned=total_xp,
        accuracy=round(accuracy, 3),
    )


# --- Mixed Quiz (MC + True/False + Fill-in-the-blank) ---

MIXED_QUIZ_PROMPT = """You are a quiz generator. Based on this note, generate exactly 1 question.
The question type MUST be: {qtype}

TITLE: {title}
CONTENT:
{content}

{type_instructions}

Return ONLY valid JSON, no other text:
{format_example}"""

TYPE_INSTRUCTIONS = {
    "multiple_choice": (
        "Generate a multiple-choice question with 4 options (1 correct, 3 wrong).",
        '{{"type": "multiple_choice", "question": "...", "correct": "...", "wrong": ["...", "...", "..."]}}',
    ),
    "true_false": (
        "Generate a statement about the content that is either true or false. "
        "Make it specific and non-obvious. About 50% should be true, 50% false.",
        '{{"type": "true_false", "statement": "...", "is_true": true}}',
    ),
    "fill_blank": (
        "Take a key sentence from the content and replace ONE important word or short phrase with ___. "
        "The blank should test a key concept.",
        '{{"type": "fill_blank", "sentence": "The ___ algorithm updates parameters by subtracting the gradient.", "answer": "gradient descent"}}',
    ),
}


async def _generate_mixed_question(
    chat_client, doc_id: UUID, title: str, content: str, qtype: str,
) -> MixedQuizQuestion | None:
    if not content or len(content.strip()) < 30:
        return None

    instructions, fmt = TYPE_INSTRUCTIONS[qtype]
    prompt = MIXED_QUIZ_PROMPT.format(
        qtype=qtype, title=title, content=content[:2500],
        type_instructions=instructions, format_example=fmt,
    )

    try:
        response = await chat_client.generate_response(
            messages=[ChatMessage(role="user", content=prompt)],
        )
    except Exception as e:
        logger.warning(f"LLM mixed quiz failed for {doc_id}: {e}")
        return None

    try:
        text = response.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        parsed = json.loads(text)
    except (json.JSONDecodeError, IndexError):
        logger.warning(f"Failed to parse mixed quiz for {doc_id}")
        return None

    actual_type = parsed.get("type", qtype)

    if actual_type == "multiple_choice":
        q = parsed.get("question", "").strip()
        correct = parsed.get("correct", "").strip()
        wrong = parsed.get("wrong", [])
        if not q or not correct or len(wrong) < 3:
            return None
        options_raw = [w.strip() for w in wrong[:3]] + [correct]
        random.shuffle(options_raw)
        return MixedQuizQuestion(
            document_id=doc_id,
            question_type="multiple_choice",
            question=q,
            options=[QuizOption(text=t, is_correct=(t == correct)) for t in options_raw],
            topic=title,
        )

    elif actual_type == "true_false":
        stmt = parsed.get("statement", "").strip()
        is_true = parsed.get("is_true", True)
        if not stmt:
            return None
        return MixedQuizQuestion(
            document_id=doc_id,
            question_type="true_false",
            question=stmt,
            is_true=bool(is_true),
            topic=title,
        )

    elif actual_type == "fill_blank":
        sentence = parsed.get("sentence", "").strip()
        answer = parsed.get("answer", "").strip()
        if not sentence or not answer or "___" not in sentence:
            return None
        return MixedQuizQuestion(
            document_id=doc_id,
            question_type="fill_blank",
            question=sentence,
            answer=answer,
            topic=title,
        )

    return None


@router.post("/quiz/generate/mixed", response_model=MixedQuizGenerateResponse)
async def generate_mixed_quiz(body: QuizGenerateRequest, request: Request):
    """Generate a mixed quiz with MC, True/False, and Fill-in-the-blank questions."""
    user = get_user_from_headers(request)
    user_id = UUID(user["user_id"])

    auth_header = request.headers.get("Authorization", "")
    access_token = auth_header.replace("Bearer ", "") if auth_header else ""

    pool = get_pool()
    async with pool.acquire() as conn:
        await register_vector(conn)
        rows = await conn.fetch(
            """SELECT document_id, title
               FROM document_embeddings
               WHERE vault_id = $1 AND user_id = $2""",
            body.vault_id, user_id,
        )

    if len(rows) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 indexed documents")

    n = min(body.num_questions, len(rows))
    sampled = random.sample(rows, n)

    # Assign question types in rotation
    qtypes = ["multiple_choice", "true_false", "fill_blank"]

    # Fetch contents in parallel
    content_tasks = [_fetch_document_content(d["document_id"], access_token) for d in sampled]
    contents = await asyncio.gather(*content_tasks)

    chat_client = get_chat_client()
    sem = asyncio.Semaphore(3)

    async def _gen(i: int) -> MixedQuizQuestion | None:
        async with sem:
            qtype = qtypes[i % len(qtypes)]
            return await _generate_mixed_question(
                chat_client, sampled[i]["document_id"],
                sampled[i]["title"], contents[i], qtype,
            )

    tasks = [_gen(i) for i in range(n)]
    results = await asyncio.gather(*tasks)
    questions = [q for q in results if q is not None]

    if not questions:
        raise HTTPException(status_code=502, detail="Could not generate questions")

    return MixedQuizGenerateResponse(questions=questions, count=len(questions))


@router.post("/quiz/submit/mixed", response_model=QuizSubmitResponse)
async def submit_mixed_quiz(body: MixedQuizSubmitRequest, request: Request):
    """Submit mixed quiz answers."""
    user = get_user_from_headers(request)
    user_id = UUID(user["user_id"])

    pool = get_pool()
    total_xp = 0
    correct_count = 0

    async with pool.acquire() as conn:
        for answer in body.answers:
            xp = XP_CORRECT if answer.correct else XP_INCORRECT
            total_xp += xp
            if answer.correct:
                correct_count += 1
            await conn.execute(
                """INSERT INTO quiz_results
                   (user_id, vault_id, document_id, question, correct, xp)
                   VALUES ($1, $2, $3, $4, $5, $6)""",
                user_id, body.vault_id, answer.document_id,
                answer.question, answer.correct, xp,
            )

    total = len(body.answers)
    return QuizSubmitResponse(
        total=total, correct=correct_count,
        xp_earned=total_xp,
        accuracy=round(correct_count / total if total > 0 else 0, 3),
    )
