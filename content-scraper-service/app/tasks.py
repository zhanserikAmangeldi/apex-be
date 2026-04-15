from celery import Celery
from celery.schedules import crontab
from app.config import settings
import asyncio

celery_app = Celery(
    "scraper_tasks",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL
)

celery_app.conf.update(
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='UTC',
    enable_utc=True,
    beat_schedule={
        'check-periodic-scrapes': {
            'task': 'app.tasks.check_and_scrape_periodic',
            'schedule': crontab(minute='*/30'),  # Every 30 minutes
        },
    }
)

@celery_app.task
def schedule_periodic_scrape(content_id: str, url: str, user_id: str, interval_hours: int):
    """Schedule periodic scraping task"""
    # This is called once to register the content for periodic scraping
    # The actual scraping is done by check_and_scrape_periodic
    pass

@celery_app.task
def check_and_scrape_periodic():
    """Check for content that needs to be re-scraped"""
    from app.database import async_session_maker
    from app.models import ScrapedContent
    from app.scrapers.strategy import ScraperStrategy
    from sqlalchemy import select
    from datetime import datetime
    from urllib.parse import urlparse
    
    async def _check_and_scrape():
        async with async_session_maker() as db:
            # Find content that needs scraping
            stmt = select(ScrapedContent).where(
                ScrapedContent.is_periodic == True,
                ScrapedContent.next_scrape_at <= datetime.utcnow()
            )
            result = await db.execute(stmt)
            contents = result.scalars().all()
            
            for content in contents:
                try:
                    # Scrape again
                    scraper = ScraperStrategy(db)
                    domain = urlparse(content.url).netloc
                    
                    result = await scraper.scrape(
                        url=content.url,
                        user_id=str(content.user_id),
                        domain=domain
                    )
                    
                    # Update content
                    content.content = result.get("content")
                    content.html = result.get("html")
                    content.content_metadata = result.get("metadata", {})
                    content.last_scraped_at = datetime.utcnow()
                    
                    # Calculate next scrape time
                    from datetime import timedelta
                    content.next_scrape_at = datetime.utcnow() + timedelta(
                        hours=content.scrape_interval_hours
                    )
                    
                    await db.commit()
                    
                    print(f"Re-scraped content {content.id}")
                    
                except Exception as e:
                    print(f"Failed to re-scrape {content.id}: {e}")
    
    # Run async function
    asyncio.run(_check_and_scrape())

@celery_app.task
def generate_embeddings_for_content(content_id: str, user_id: str, text: str):
    """Generate embeddings for content (Celery task)"""
    from app.routes.scraper import generate_embeddings_task
    asyncio.run(generate_embeddings_task(content_id, user_id, text))
