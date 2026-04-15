from typing import Optional, Dict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models import UserSiteSession
from app.scrapers.public_scraper import PublicScraper
from app.scrapers.authenticated_scraper import AuthenticatedScraper
from datetime import datetime
import uuid

class NeedAuthException(Exception):
    """Raised when authentication is required"""
    pass

class ScraperStrategy:
    """Chooses scraping strategy based on site and available credentials"""
    
    def __init__(self, db: AsyncSession):
        self.db = db
        self.public_scraper = PublicScraper()
        self.auth_scraper = AuthenticatedScraper()
    
    async def get_user_session(self, user_id: str, domain: str) -> Optional[UserSiteSession]:
        """Get user's saved session for domain"""
        stmt = select(UserSiteSession).where(
            UserSiteSession.user_id == uuid.UUID(user_id),
            UserSiteSession.domain == domain
        )
        result = await self.db.execute(stmt)
        session = result.scalar_one_or_none()
        
        # Check if session is expired
        if session and session.expires_at and session.expires_at < datetime.utcnow():
            return None
        
        return session
    
    async def scrape(self, url: str, user_id: str, domain: str) -> Dict:
        """Main scraping method - tries different strategies"""
        
        # 1. Check if user has saved session for this domain
        session = await self.get_user_session(user_id, domain)
        if session:
            try:
                result = await self.auth_scraper.scrape_with_session(url, session)
                # Update last_used timestamp
                session.last_used = datetime.utcnow()
                await self.db.commit()
                return result
            except Exception as e:
                print(f"Auth scraping failed: {e}, falling back to public")
        
        # 2. Try public scraping
        try:
            return await self.public_scraper.scrape(url)
        except Exception as e:
            # 3. If public scraping fails, request authentication
            raise NeedAuthException(
                f"Unable to scrape {domain}. Please authorize via browser extension."
            )
