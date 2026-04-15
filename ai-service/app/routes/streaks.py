import logging
from uuid import UUID
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Request

from app.auth import get_user_from_headers
from app.database import get_pool
from app.models import StreakResponse, ForecastResponse, ForecastDay

logger = logging.getLogger("ai-service")
router = APIRouter(prefix="/api/v1", tags=["streaks"])


@router.get("/streaks/{vault_id}", response_model=StreakResponse)
async def get_streak(vault_id: UUID, request: Request):
    """Calculate study streak from quiz and flashcard activity."""
    user = get_user_from_headers(request)
    user_id = UUID(user["user_id"])

    pool = get_pool()
    async with pool.acquire() as conn:
        # Get all distinct activity dates (quiz + flashcard reviews)
        rows = await conn.fetch(
            """SELECT DISTINCT d::date AS activity_date FROM (
                 SELECT created_at AS d FROM quiz_results
                   WHERE user_id = $1 AND vault_id = $2
                 UNION ALL
                 SELECT updated_at AS d FROM flashcards
                   WHERE user_id = $1 AND vault_id = $2 AND reps > 0
               ) sub
               ORDER BY activity_date DESC""",
            user_id, vault_id,
        )

    if not rows:
        return StreakResponse(
            current_streak=0, longest_streak=0,
            today_done=False, total_study_days=0,
        )

    dates = [r["activity_date"] for r in rows]
    today = datetime.now(timezone.utc).date()
    today_done = dates[0] == today

    # Calculate current streak
    current_streak = 0
    check_date = today if today_done else today - timedelta(days=1)
    for d in dates:
        if d == check_date:
            current_streak += 1
            check_date -= timedelta(days=1)
        elif d < check_date:
            break

    # Calculate longest streak
    longest = 1
    run = 1
    for i in range(1, len(dates)):
        if dates[i - 1] - dates[i] == timedelta(days=1):
            run += 1
            longest = max(longest, run)
        else:
            run = 1

    return StreakResponse(
        current_streak=current_streak,
        longest_streak=max(longest, current_streak),
        today_done=today_done,
        total_study_days=len(dates),
    )


@router.get("/forecast/{vault_id}", response_model=ForecastResponse)
async def get_forecast(vault_id: UUID, request: Request):
    """Forecast flashcard reviews for the next 7 days."""
    user = get_user_from_headers(request)
    user_id = UUID(user["user_id"])

    pool = get_pool()
    now = datetime.now(timezone.utc)
    end = now + timedelta(days=7)

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT (next_review AT TIME ZONE 'UTC')::date AS review_date,
                      COUNT(*) AS cnt
               FROM flashcards
               WHERE user_id = $1 AND vault_id = $2
                 AND next_review <= $3
               GROUP BY review_date
               ORDER BY review_date""",
            user_id, vault_id, end,
        )

    # Build 7-day forecast
    forecast = []
    total = 0
    for i in range(7):
        day = (now + timedelta(days=i)).date()
        day_str = day.isoformat()
        count = 0
        for r in rows:
            if r["review_date"] <= day:
                count += r["cnt"]
        # Cards due on this day = cards with next_review on or before this day
        # minus cards already counted in previous days
        forecast.append(ForecastDay(date=day_str, cards_due=count))

    # Recalculate: each day shows only NEW cards becoming due
    cumulative = []
    for i in range(7):
        day = (now + timedelta(days=i)).date()
        cnt = sum(r["cnt"] for r in rows if r["review_date"] == day)
        cumulative.append(ForecastDay(date=day.isoformat(), cards_due=cnt))
        total += cnt

    # Day 0 includes all overdue
    overdue = sum(r["cnt"] for r in rows if r["review_date"] < now.date())
    if cumulative:
        cumulative[0] = ForecastDay(
            date=cumulative[0].date,
            cards_due=cumulative[0].cards_due + overdue,
        )
        total += overdue

    return ForecastResponse(forecast=cumulative, total_due_7d=total)
