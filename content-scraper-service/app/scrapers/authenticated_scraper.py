from typing import Dict
from app.models import UserSiteSession
from app.security import decrypt_data
from bs4 import BeautifulSoup
import trafilatura

try:
    from playwright.async_api import async_playwright
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False
    print("WARNING: Playwright not available. Authenticated scraping will be disabled.")

class AuthenticatedScraper:
    async def scrape_with_session(self, url: str, session: UserSiteSession) -> Dict:
        if not PLAYWRIGHT_AVAILABLE:
            raise Exception(
                "Playwright is not available. "
                "Authenticated scraping requires Playwright. "
                "Please install it: pip install playwright && playwright install chromium"
            )
        
        cookies = decrypt_data(session.encrypted_cookies)
        
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context()
            
            await context.add_cookies(cookies)
            
            page = await context.new_page()
            await page.goto(url, wait_until="networkidle")
            
            html = await page.content()
            title = await page.title()
            
            await browser.close()
        
        content = trafilatura.extract(
            html,
            include_comments=False,
            include_tables=True,
            include_links=True
        )
        
        soup = BeautifulSoup(html, 'lxml')
        metadata = self._extract_metadata(soup)
        
        return {
            "title": title,
            "content": content,
            "html": html,
            "metadata": metadata
        }
    
    def _extract_metadata(self, soup: BeautifulSoup) -> Dict:
        metadata = {}
        
        for tag in soup.find_all("meta", property=lambda x: x and x.startswith("og:")):
            key = tag.get("property", "").replace("og:", "")
            metadata[key] = tag.get("content", "")
        
        desc_tag = soup.find("meta", attrs={"name": "description"})
        if desc_tag:
            metadata["description"] = desc_tag.get("content", "")
        
        return metadata
