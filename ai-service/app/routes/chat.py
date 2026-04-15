from uuid import UUID
import logging
from fastapi import APIRouter, Request, HTTPException
import httpx

from app.auth import get_user_from_headers
from app.database import get_pool
from app.chat import get_chat_client
from app.youtube import get_youtube_client
from app.config import settings
from app.models import (
    ChatRequest,
    ChatResponse,
    ChatMessage,
    ChatSession,
    VideoSearchRequest,
    VideoSearchResponse,
)

logger = logging.getLogger("ai-service")
router = APIRouter(prefix="/api/v1", tags=["chat"])


async def fetch_document_content(document_id: UUID, access_token: str) -> str:
    """Fetch document content from editor service."""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{settings.editor_service_url}/api/v1/documents/{document_id}/export/text",
                headers={"Authorization": f"Bearer {access_token}"},
                timeout=10.0
            )
            
            if response.status_code == 200:
                data = response.json()
                return data.get("content", "")
            else:
                logger.error(f"Failed to fetch document: {response.status_code}")
                return ""
    except Exception as e:
        logger.error(f"Error fetching document content: {e}")
        return ""


@router.post("/chat", response_model=ChatResponse)
async def chat_with_document(body: ChatRequest, request: Request):
    """Chat about a document with optional video recommendations."""
    user = get_user_from_headers(request)
    user_id = UUID(user["user_id"])
    
    # Get access token for fetching document
    auth_header = request.headers.get("Authorization", "")
    access_token = auth_header.replace("Bearer ", "") if auth_header else ""

    pool = get_pool()
    chat_client = get_chat_client()
    youtube_client = get_youtube_client()

    async with pool.acquire() as conn:
        # Get or create session
        if body.session_id:
            session = await conn.fetchrow(
                "SELECT * FROM chat_sessions WHERE id = $1 AND user_id = $2",
                body.session_id, user_id
            )
            if not session:
                raise HTTPException(status_code=404, detail="Session not found")
            session_id = body.session_id
        else:
            # Create new session
            session_id = await conn.fetchval(
                """INSERT INTO chat_sessions (user_id, document_id, title)
                   VALUES ($1, $2, $3)
                   RETURNING id""",
                user_id, body.document_id, "Chat about note"
            )

        # Get conversation history
        history_rows = await conn.fetch(
            """SELECT role, content, metadata
               FROM chat_messages
               WHERE session_id = $1
               ORDER BY created_at ASC
               LIMIT 20""",
            session_id
        )
        
        history = [
            ChatMessage(
                role=row["role"], 
                content=row["content"], 
                metadata=row["metadata"] if isinstance(row["metadata"], dict) else {}
            )
            for row in history_rows
        ]

        # Add user message to history
        user_message = ChatMessage(role="user", content=body.message)
        history.append(user_message)

        # Save user message
        await conn.execute(
            """INSERT INTO chat_messages (session_id, role, content)
               VALUES ($1, $2, $3)""",
            session_id, "user", body.message
        )

        # Fetch document content for context
        document_content = await fetch_document_content(body.document_id, access_token)

        # Generate AI response
        try:
            ai_response_text = await chat_client.generate_response(
                messages=history,
                document_context=document_content
            )
        except Exception as e:
            logger.error(f"Chat generation failed: {e}")
            raise HTTPException(status_code=500, detail="Failed to generate response")

        assistant_message = ChatMessage(role="assistant", content=ai_response_text)

        # Save assistant message
        await conn.execute(
            """INSERT INTO chat_messages (session_id, role, content)
               VALUES ($1, $2, $3)""",
            session_id, "assistant", ai_response_text
        )

        # Search for relevant videos if requested
        videos = []
        if body.include_videos:
            # Extract key topics from document title and user message
            doc_row = await conn.fetchrow(
                "SELECT title FROM document_embeddings WHERE document_id = $1",
                body.document_id
            )
            doc_title = doc_row["title"] if doc_row else ""
            
            # Create search query combining document title and user question
            video_query = f"{doc_title} {body.message}"[:200]
            videos = youtube_client.search_videos(video_query, max_results=3)

        return ChatResponse(
            session_id=session_id,
            message=assistant_message,
            videos=videos
        )


@router.get("/chat/sessions/{document_id}", response_model=list[ChatSession])
async def get_document_chat_sessions(document_id: UUID, request: Request):
    """Get all chat sessions for a document."""
    user = get_user_from_headers(request)
    user_id = UUID(user["user_id"])

    pool = get_pool()
    async with pool.acquire() as conn:
        sessions = await conn.fetch(
            """SELECT id, document_id, title, created_at, updated_at
               FROM chat_sessions
               WHERE user_id = $1 AND document_id = $2
               ORDER BY updated_at DESC""",
            user_id, document_id
        )

        result = []
        for session in sessions:
            messages = await conn.fetch(
                """SELECT role, content, metadata, created_at
                   FROM chat_messages
                   WHERE session_id = $1
                   ORDER BY created_at ASC""",
                session["id"]
            )
            
            result.append(ChatSession(
                id=session["id"],
                document_id=session["document_id"],
                title=session["title"],
                created_at=session["created_at"],
                updated_at=session["updated_at"],
                messages=[
                    ChatMessage(
                        role=msg["role"],
                        content=msg["content"],
                        metadata=msg["metadata"]
                    )
                    for msg in messages
                ]
            ))

        return result


@router.post("/videos/search", response_model=VideoSearchResponse)
async def search_videos(body: VideoSearchRequest, request: Request):
    """Search YouTube videos by query."""
    get_user_from_headers(request)  # Verify authentication
    
    youtube_client = get_youtube_client()
    videos = youtube_client.search_videos(body.query, body.max_results)

    return VideoSearchResponse(
        query=body.query,
        videos=videos,
        count=len(videos)
    )
