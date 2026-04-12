import logging
from openai import AsyncOpenAI
from app.config import settings
from app.models import ChatMessage

logger = logging.getLogger("ai-service")


class ChatClient:
    def __init__(self):
        self.api_key = settings.openai_api_key
        if not self.api_key:
            logger.warning("OpenAI API key not configured")
            self.client = None
        else:
            self.client = AsyncOpenAI(api_key=self.api_key)
        self.model = settings.openai_model

    async def generate_response(
        self,
        messages: list[ChatMessage],
        document_context: str = ""
    ) -> str:
        """Generate chat response with document context."""
        if not self.client:
            raise ValueError("OpenAI API not configured")

        # Build messages for OpenAI
        openai_messages = []
        
        # Add system message with document context
        if document_context:
            system_content = f"""You are a helpful AI assistant that helps students understand their study notes.

The student is currently viewing this note:

{document_context[:3000]}

Your role:
- Answer questions about the note content
- Explain concepts in simple terms
- Suggest related topics to explore
- When asked about videos, provide search queries that would find relevant educational content

Keep responses concise and educational."""
            openai_messages.append({"role": "system", "content": system_content})

        # Add conversation history
        for msg in messages:
            openai_messages.append({
                "role": msg.role,
                "content": msg.content
            })

        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=openai_messages,
                temperature=0.7,
                max_tokens=1000
            )
            
            return response.choices[0].message.content

        except Exception as e:
            logger.error(f"OpenAI API error: {e}")
            raise


# Singleton instance
_chat_client = None


def get_chat_client() -> ChatClient:
    global _chat_client
    if _chat_client is None:
        _chat_client = ChatClient()
    return _chat_client
