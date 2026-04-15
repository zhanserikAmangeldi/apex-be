from app.config import settings
import asyncio


async def schedule_periodic_scrape(content_id: str, url: str, user_id: str, interval_hours: int):
    pass


async def check_and_scrape_periodic():
    from app.database import async_session_maker
    from app.models import ScrapedContent
    from app.scrapers.strategy import ScraperStrategy
    from sqlalchemy import select
    from datetime import datetime, timedelta
    from urllib.parse import urlparse

    async with async_session_maker() as db:
        stmt = select(ScrapedContent).where(
            ScrapedContent.is_periodic == True,
            ScrapedContent.next_scrape_at <= datetime.utcnow()
        )
        result = await db.execute(stmt)
        contents = result.scalars().all()

        for content in contents:
            try:
                scraper = ScraperStrategy(db)
                domain = urlparse(content.url).netloc

                result = await scraper.scrape(
                    url=content.url,
                    user_id=str(content.user_id),
                    domain=domain
                )

                content.content = result.get("content")
                content.html = result.get("html")
                content.content_metadata = result.get("metadata", {})
                content.last_scraped_at = datetime.utcnow()
                content.next_scrape_at = datetime.utcnow() + timedelta(
                    hours=content.scrape_interval_hours
                )

                await db.commit()
                print(f"Re-scraped content {content.id}")

            except Exception as e:
                print(f"Failed to re-scrape {content.id}: {e}")
