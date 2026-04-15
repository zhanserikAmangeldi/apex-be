from sqlalchemy import Column, String, DateTime, Text, Boolean, JSON, Integer
from sqlalchemy.dialects.postgresql import UUID
from datetime import datetime
import uuid
from app.database import Base

class UserSiteSession(Base):
    __tablename__ = "user_site_sessions"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    domain = Column(String(255), nullable=False, index=True)
    encrypted_cookies = Column(Text, nullable=False)
    encrypted_local_storage = Column(Text)
    expires_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_used = Column(DateTime, default=datetime.utcnow)

class ScrapedContent(Base):
    __tablename__ = "scraped_content"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    url = Column(Text, nullable=False)
    domain = Column(String(255), nullable=False, index=True)
    title = Column(Text)
    content = Column(Text)
    html = Column(Text)
    content_metadata = Column(JSON)
    
    ai_summary = Column(Text)
    ai_key_points = Column(JSON)
    ai_study_notes = Column(Text)
    
    document_id = Column(UUID(as_uuid=True), index=True)
    
    is_periodic = Column(Boolean, default=False)
    scrape_interval_hours = Column(Integer)
    last_scraped_at = Column(DateTime, default=datetime.utcnow)
    next_scrape_at = Column(DateTime)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class ContentEmbedding(Base):
    __tablename__ = "content_embeddings"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    content_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    chunk_index = Column(Integer, nullable=False)
    chunk_text = Column(Text, nullable=False)
    embedding = Column(JSON, nullable=False)  # Store as JSON array
    created_at = Column(DateTime, default=datetime.utcnow)
