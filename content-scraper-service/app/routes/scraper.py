from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, HttpUrl
from typing import Optional
from app.database import get_db
from app.models import ScrapedContent, UserSiteSession
from app.scrapers.strategy import ScraperStrategy
from app.tasks import schedule_periodic_scrape
from app.integrations.ai_service import ai_service
from app.integrations.editor_service import editor_service
from sqlalchemy import select
import uuid
from urllib.parse import urlparse
from datetime import datetime, timedelta

router = APIRouter()

class ScrapeRequest(BaseModel):
    user_id: str
    url: HttpUrl
    vault_id: Optional[str] = None
    periodic: bool = False
    interval_hours: Optional[int] = 24
    create_document: bool = True
    generate_ai_notes: bool = True

class ScrapeResponse(BaseModel):
    content_id: str
    document_id: Optional[str]
    title: Optional[str]
    content_preview: str
    ai_summary: Optional[str]
    status: str

@router.post("/scrape", response_model=ScrapeResponse)
async def scrape_url(
    request: ScrapeRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    try:
        user_uuid = uuid.UUID(request.user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid user_id format: must be a valid UUID")
    
    scraper = ScraperStrategy(db)
    domain = urlparse(str(request.url)).netloc
    
    try:
        result = await scraper.scrape(
            url=str(request.url),
            user_id=request.user_id,
            domain=domain
        )
        
        ai_notes = None
        ai_summary = None
        ai_key_points = None
        
        if request.generate_ai_notes and result.get("content"):
            try:
                ai_notes = await ai_service.create_study_notes(
                    content=result["content"],
                    title=result.get("title", "Untitled")
                )
                ai_summary = ai_notes.get("summary")
                ai_key_points = ai_notes.get("key_points")
            except Exception as e:
                print(f"AI processing failed: {e}")
        
        next_scrape_at = None
        if request.periodic:
            next_scrape_at = datetime.utcnow() + timedelta(hours=request.interval_hours)
        
        content = ScrapedContent(
            user_id=user_uuid,
            url=str(request.url),
            domain=domain,
            title=result.get("title"),
            content=result.get("content"),
            html=result.get("html"),
            content_metadata=result.get("metadata", {}),
            ai_summary=ai_summary,
            ai_key_points=ai_key_points,
            ai_study_notes=ai_notes.get("notes") if ai_notes else None,
            is_periodic=request.periodic,
            scrape_interval_hours=request.interval_hours if request.periodic else None,
            next_scrape_at=next_scrape_at
        )
        
        print(f"Saving content with URL: {str(request.url)}")
        print(f"Content title: {result.get('title')}")
        
        db.add(content)
        await db.commit()
        await db.refresh(content)
        
        document_id = None
        if request.create_document and result.get("content"):
            try:
                document = await editor_service.create_note_from_scraped_content(
                    user_id=request.user_id,
                    title=result.get("title", "Untitled"),
                    content=result.get("content"),
                    source_url=str(request.url),
                    vault_id=request.vault_id,
                    ai_notes=ai_notes
                )
                document_id = document.get("id")
                
                content.document_id = uuid.UUID(document_id)
                await db.commit()
            except Exception as e:
                print(f"Document creation failed: {e}")
        
        if result.get("content"):
            background_tasks.add_task(
                generate_embeddings_task,
                content_id=str(content.id),
                user_id=request.user_id,
                text=result["content"]
            )
        
        if request.periodic:
            background_tasks.add_task(
                schedule_periodic_scrape,
                content_id=str(content.id),
                url=str(request.url),
                user_id=request.user_id,
                interval_hours=request.interval_hours
            )
        
        return ScrapeResponse(
            content_id=str(content.id),
            document_id=document_id,
            title=content.title,
            content_preview=content.content[:200] if content.content else "",
            ai_summary=ai_summary,
            status="success"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/content/{content_id}")
async def get_content(
    content_id: str,
    db: AsyncSession = Depends(get_db)
):
    stmt = select(ScrapedContent).where(ScrapedContent.id == uuid.UUID(content_id))
    result = await db.execute(stmt)
    content = result.scalar_one_or_none()
    
    if not content:
        raise HTTPException(status_code=404, detail="Content not found")
    
    return {
        "id": str(content.id),
        "url": content.url,
        "title": content.title,
        "content": content.content,
        "metadata": content.content_metadata,
        "created_at": content.created_at,
        "updated_at": content.updated_at
    }

@router.get("/content/user/{user_id}")
async def get_user_content(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    try:
        user_uuid = uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid user_id format: must be a valid UUID")
    
    stmt = select(ScrapedContent).where(
        ScrapedContent.user_id == user_uuid
    ).order_by(ScrapedContent.created_at.desc())
    
    result = await db.execute(stmt)
    contents = result.scalars().all()
    
    return [{
        "id": str(c.id),
        "url": c.url,
        "title": c.title,
        "domain": c.domain,
        "created_at": c.created_at,
        "updated_at": c.updated_at
    } for c in contents]


async def generate_embeddings_task(content_id: str, user_id: str, text: str):
    from app.models import ContentEmbedding
    from app.database import async_session_maker
    
    chunk_size = 500
    chunks = [text[i:i+chunk_size] for i in range(0, len(text), chunk_size)]
    
    try:
        embeddings = await ai_service.generate_embeddings(chunks)
        
        async with async_session_maker() as db:
            for idx, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
                emb = ContentEmbedding(
                    content_id=uuid.UUID(content_id),
                    user_id=uuid.UUID(user_id),
                    chunk_index=idx,
                    chunk_text=chunk,
                    embedding=embedding
                )
                db.add(emb)
            await db.commit()
    except Exception as e:
        print(f"Embedding generation failed: {e}")

@router.post("/search")
async def search_content(
    query: str,
    user_id: str,
    limit: int = 10,
    db: AsyncSession = Depends(get_db)
):
    from app.models import ContentEmbedding
    import numpy as np
    
    try:
        user_uuid = uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid user_id format: must be a valid UUID")
    
    query_embeddings = await ai_service.generate_embeddings([query])
    query_embedding = query_embeddings[0]
    
    stmt = select(ContentEmbedding).where(
        ContentEmbedding.user_id == user_uuid
    )
    result = await db.execute(stmt)
    embeddings = result.scalars().all()
    
    results = []
    for emb in embeddings:
        similarity = cosine_similarity(query_embedding, emb.embedding)
        if similarity > 0.3:
            results.append({
                "content_id": str(emb.content_id),
                "chunk_text": emb.chunk_text,
                "similarity": similarity
            })
    
    results.sort(key=lambda x: x["similarity"], reverse=True)
    
    seen_ids = set()
    unique_results = []
    for r in results[:limit]:
        if r["content_id"] not in seen_ids:
            seen_ids.add(r["content_id"])
            
            stmt = select(ScrapedContent).where(
                ScrapedContent.id == uuid.UUID(r["content_id"])
            )
            content_result = await db.execute(stmt)
            content = content_result.scalar_one_or_none()
            
            if content:
                unique_results.append({
                    "id": str(content.id),
                    "title": content.title,
                    "url": content.url,
                    "ai_summary": content.ai_summary,
                    "similarity": r["similarity"],
                    "matched_text": r["chunk_text"]
                })
    
    return unique_results

def cosine_similarity(a: list, b: list) -> float:
    import numpy as np
    a = np.array(a)
    b = np.array(b)
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))
