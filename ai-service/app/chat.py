import logging
from typing import Protocol
from openai import AsyncOpenAI
from app.config import settings
from app.models import ChatMessage

logger = logging.getLogger("ai-service")


class ChatProvider(Protocol):
    async def generate_response(
        self,
        messages: list[ChatMessage],
        document_context: str = ""
    ) -> str:
        ...


class OpenAIChatProvider:
    
    def __init__(self, api_key: str, model: str, base_url: str):
        self.api_key = api_key
        self.model = model
        if not self.api_key:
            logger.warning(f"API key not configured for {base_url}")
            self.client = None
        else:
            self.client = AsyncOpenAI(api_key=api_key, base_url=base_url)

    async def generate_response(
        self,
        messages: list[ChatMessage],
        document_context: str = ""
    ) -> str:
        if not self.client:
            raise ValueError("API not configured")

        openai_messages = []
        
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
            logger.error(f"API error: {e}")
            raise


class ChatClient:
    
    def __init__(self):
        self.provider = self._create_provider()

    def _create_provider(self) -> ChatProvider:
        provider_name = settings.chat_provider.lower()
        
        if provider_name == "openai":
            return OpenAIChatProvider(
                api_key=settings.openai_api_key,
                model=settings.openai_model,
                base_url=settings.openai_base_url
            )
        elif provider_name == "deepseek":
            return OpenAIChatProvider(
                api_key=settings.deepseek_api_key,
                model=settings.deepseek_model,
                base_url=settings.deepseek_base_url
            )
        else:
            raise ValueError(f"Unknown chat provider: {provider_name}. Use 'openai' or 'deepseek'")

    async def generate_response(
        self,
        messages: list[ChatMessage],
        document_context: str = ""
    ) -> str:
        return await self.provider.generate_response(messages, document_context)


_chat_client = None


def get_chat_client() -> ChatClient:
    global _chat_client
    if _chat_client is None:
        _chat_client = ChatClient()
    return _chat_client
