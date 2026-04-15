import trafilatura
import httpx
from typing import Dict
from bs4 import BeautifulSoup
from app.config import settings

try:
    from playwright.async_api import async_playwright
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False

class PublicScraper:
    """Scraper for public content without authentication"""
    
    async def scrape(self, url: str, use_browser: bool = True) -> Dict:
        """Scrape public URL
        
        Args:
            url: URL to scrape
            use_browser: If True, use Playwright for JS-heavy sites. If False, use simple HTTP.
        """
        
        # Try with Playwright first for better content extraction
        if use_browser and PLAYWRIGHT_AVAILABLE:
            try:
                return await self._scrape_with_browser(url)
            except Exception as e:
                print(f"Browser scraping failed, falling back to HTTP: {e}")
        
        # Fallback to simple HTTP scraping
        return await self._scrape_with_http(url)
    
    async def _scrape_with_browser(self, url: str) -> Dict:
        """Scrape using Playwright browser"""
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()
            
            # Navigate and wait for content to load
            await page.goto(url, wait_until="networkidle", timeout=30000)
            
            # Get page content
            html = await page.content()
            title = await page.title()
            
            await browser.close()
        
        # Extract clean text content using trafilatura
        content = trafilatura.extract(
            html,
            include_comments=False,
            include_tables=True,
            include_links=True
        )
        
        # Extract metadata
        soup = BeautifulSoup(html, 'lxml')
        metadata = self._extract_metadata(soup)
        
        return {
            "title": title,
            "content": content or "Content extraction failed",
            "html": html,
            "metadata": metadata
        }
    
    async def _scrape_with_http(self, url: str) -> Dict:
        """Scrape using simple HTTP client"""
        async with httpx.AsyncClient(
            headers={"User-Agent": settings.USER_AGENT},
            timeout=settings.SCRAPE_TIMEOUT
        ) as client:
            response = await client.get(url)
            response.raise_for_status()
            html = response.text
        
        # Extract clean text content using trafilatura
        content = trafilatura.extract(
            html,
            include_comments=False,
            include_tables=True,
            include_links=True
        )
        
        # Extract title using BeautifulSoup
        soup = BeautifulSoup(html, 'lxml')
        title = soup.title.string if soup.title else None
        
        # Extract metadata
        metadata = self._extract_metadata(soup)
        
        return {
            "title": title,
            "content": content or "Content extraction failed",
            "html": html,
            "metadata": metadata
        }
    
    def _extract_metadata(self, soup: BeautifulSoup) -> Dict:
        """Extract metadata from HTML"""
        metadata = {}
        
        # Open Graph tags
        for tag in soup.find_all("meta", property=lambda x: x and x.startswith("og:")):
            key = tag.get("property", "").replace("og:", "")
            metadata[key] = tag.get("content", "")
        
        # Meta description
        desc_tag = soup.find("meta", attrs={"name": "description"})
        if desc_tag:
            metadata["description"] = desc_tag.get("content", "")
        
        return metadata
