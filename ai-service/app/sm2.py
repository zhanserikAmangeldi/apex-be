"""
SuperMemo 2 (SM-2) spaced repetition algorithm.

Quality scale:
  5 — perfect response
  4 — correct after hesitation
  3 — correct with difficulty
  2 — incorrect, easy recall
  1 — incorrect, remembered
  0 — complete blackout
"""

from datetime import datetime, timedelta, timezone


def sm2_review(
    quality: int,
    ease_factor: float,
    interval: int,
    reps: int,
) -> tuple[float, int, int, datetime]:
    """
    Apply SM-2 algorithm and return updated (ease_factor, interval, reps, next_review).
    """
    if quality < 3:
        # Failed — reset
        interval = 1
        reps = 0
    else:
        if reps == 0:
            interval = 1
        elif reps == 1:
            interval = 6
        else:
            interval = round(interval * ease_factor)
        reps += 1

    ease_factor = max(
        1.3,
        ease_factor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02),
    )

    next_review = datetime.now(timezone.utc) + timedelta(days=interval)

    return ease_factor, interval, reps, next_review
