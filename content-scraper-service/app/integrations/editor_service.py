import httpx
from typing import Dict, Optional
from app.config import settings
import json

class EditorServiceClient:
    """Client for Editor Service integration"""
    
    def __init__(self):
        self.base_url = settings.EDITOR_SERVICE_URL
        self.timeout = 30.0
    
    async def create_document(
        self,
        user_id: str,
        title: str,
        content: str,
        vault_id: Optional[str] = None,
        metadata: Optional[Dict] = None
    ) -> Dict:
        """Create a new document in editor service"""
        
        # Create document
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            # First create the document
            response = await client.post(
                f"{self.base_url}/api/documents",
                json={
                    "title": title,
                    "vaultId": vault_id,
                    "isFolder": False
                },
                headers={"X-User-Id": user_id}
            )
            response.raise_for_status()
            document = response.json()
            
            # Store metadata if provided
            if metadata:
                document["metadata"] = metadata
            
            return document
    
    async def update_document_content(
        self,
        document_id: str,
        user_id: str,
        content: str
    ) -> bool:
        """Update document content via WebSocket/CRDT"""
        # Note: This would typically go through WebSocket
        # For now, we'll store it as a note in the metadata
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.patch(
                f"{self.base_url}/api/documents/{document_id}",
                json={"title": content[:100]},  # Temporary
                headers={"X-User-Id": user_id}
            )
            return response.status_code == 200
    
    async def add_tags_to_document(
        self,
        document_id: str,
        user_id: str,
        tags: list[str]
    ) -> bool:
        """Add tags to document"""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            for tag in tags:
                await client.post(
                    f"{self.base_url}/api/documents/{document_id}/tags",
                    json={"name": tag},
                    headers={"X-User-Id": user_id}
                )
            return True
    
    async def create_note_from_scraped_content(
        self,
        user_id: str,
        title: str,
        content: str,
        source_url: str,
        vault_id: Optional[str] = None,
        ai_notes: Optional[Dict] = None
    ) -> Dict:
        """Create a complete note document from scraped content"""
        
        # Format content with AI notes if available
        formatted_content = self._format_note_content(
            title=title,
            content=content,
            source_url=source_url,
            ai_notes=ai_notes
        )
        
        # Create document
        document = await self.create_document(
            user_id=user_id,
            title=title,
            content=formatted_content,
            vault_id=vault_id,
            metadata={
                "source_url": source_url,
                "source_type": "web_scrape",
                "has_ai_notes": ai_notes is not None
            }
        )
        
        # Add tags
        tags = ["web-content", "self-study"]
        if ai_notes:
            tags.append("ai-processed")
        
        await self.add_tags_to_document(
            document_id=document["id"],
            user_id=user_id,
            tags=tags
        )
        
        return document
    
    def _format_note_content(
        self,
        title: str,
        content: str,
        source_url: str,
        ai_notes: Optional[Dict] = None
    ) -> str:
        """Format content as markdown note"""
        
        parts = [
            f"# {title}\n",
            f"**Source:** [{source_url}]({source_url})\n",
            f"**Captured:** {self._get_timestamp()}\n",
            "---\n"
        ]
        
        if ai_notes:
            parts.append("## 📝 AI-Generated Study Notes\n")
            parts.append(ai_notes.get("notes", "") + "\n\n")
            parts.append("---\n")
        
        parts.append("## 📄 Original Content\n")
        parts.append(content)
        
        return "\n".join(parts)
    
    def _get_timestamp(self) -> str:
        from datetime import datetime
        return datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")

editor_service = EditorServiceClient()
