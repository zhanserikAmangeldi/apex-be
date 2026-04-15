from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timedelta
from app.database import get_db
from app.models import UserSiteSession
from app.security import encrypt_data, decrypt_data
from sqlalchemy import select
import uuid

router = APIRouter()

class CookieData(BaseModel):
    name: str
    value: str
    domain: str
    path: str = "/"
    expires: Optional[float] = None
    httpOnly: bool = False
    secure: bool = False

class SessionCaptureRequest(BaseModel):
    user_id: str
    domain: str
    cookies: List[CookieData]
    localStorage: Optional[dict] = None

@router.post("/sessions/capture")
async def capture_session(
    request: SessionCaptureRequest,
    db: AsyncSession = Depends(get_db)
):
    try:
        user_uuid = uuid.UUID(request.user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid user_id format: must be a valid UUID")
    
    cookies_dict = [cookie.model_dump() for cookie in request.cookies]
    
    encrypted_cookies = encrypt_data(cookies_dict)
    encrypted_storage = encrypt_data(request.localStorage) if request.localStorage else None
    
    expires_at = None
    if request.cookies:
        cookie_expires = [c.expires for c in request.cookies if c.expires]
        if cookie_expires:
            expires_at = datetime.fromtimestamp(min(cookie_expires))

    
    stmt = select(UserSiteSession).where(
        UserSiteSession.user_id == user_uuid,
        UserSiteSession.domain == request.domain
    )
    result = await db.execute(stmt)
    existing_session = result.scalar_one_or_none()
    if existing_session:
        existing_session.encrypted_cookies = encrypted_cookies
        existing_session.encrypted_local_storage = encrypted_storage
        existing_session.expires_at = expires_at
        existing_session.last_used = datetime.utcnow()
    else:
        session = UserSiteSession(
            user_id=user_uuid,
            domain=request.domain,
            encrypted_cookies=encrypted_cookies,
            encrypted_local_storage=encrypted_storage,
            expires_at=expires_at
        )
        db.add(session)
    
    await db.commit()
    
    return {"status": "success", "message": "Session captured successfully"}

@router.get("/sessions/{user_id}")
async def get_user_sessions(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    try:
        user_uuid = uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid user_id format: must be a valid UUID")
    
    stmt = select(UserSiteSession).where(
        UserSiteSession.user_id == user_uuid
    )
    result = await db.execute(stmt)
    sessions = result.scalars().all()
    
    return [{
        "id": str(s.id),
        "domain": s.domain,
        "created_at": s.created_at,
        "last_used": s.last_used,
        "expires_at": s.expires_at,
        "is_expired": s.expires_at and s.expires_at < datetime.utcnow()
    } for s in sessions]

@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: str,
    db: AsyncSession = Depends(get_db)
):
    stmt = select(UserSiteSession).where(UserSiteSession.id == uuid.UUID(session_id))
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    await db.delete(session)
    await db.commit()
    
    return {"status": "success", "message": "Session deleted"}
