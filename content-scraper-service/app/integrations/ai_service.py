import httpx
from typing import Dict, List
from app.config import settings

class AIServiceClient:
    """Client for AI Service integration"""
    
    def __init__(self):
        self.base_url = settings.AI_SERVICE_URL
        self.timeout = 30.0
    
    async def generate_summary(self, content: str, max_length: int = 200) -> str:
        """Generate summary using AI"""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.base_url}/api/v1/chat/completions",
                json={
                    "messages": [
                        {
                            "role": "system",
                            "content": "You are a helpful assistant that creates concise summaries."
                        },
                        {
                            "role": "user",
                            "content": f"Create a concise summary (max {max_length} words) of this content:\n\n{content[:3000]}"
                        }
                    ],
                    "max_tokens": 300
                }
            )
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"]
    
    async def extract_key_points(self, content: str, num_points: int = 5) -> List[str]:
        """Extract key points from content"""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.base_url}/api/v1/chat/completions",
                json={
                    "messages": [
                        {
                            "role": "system",
                            "content": "Extract key points from text. Return as numbered list."
                        },
                        {
                            "role": "user",
                            "content": f"Extract {num_points} key points from:\n\n{content[:3000]}"
                        }
                    ],
                    "max_tokens": 500
                }
            )
            response.raise_for_status()
            data = response.json()
            text = data["choices"][0]["message"]["content"]
            # Parse numbered list
            points = [line.strip() for line in text.split('\n') if line.strip() and line[0].isdigit()]
            return points[:num_points]

    
    async def generate_embeddings(self, texts: List[str]) -> List[List[float]]:
        """Generate embeddings for texts"""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.base_url}/api/v1/embeddings/batch",
                json={"texts": texts}
            )
            response.raise_for_status()
            data = response.json()
            return data["embeddings"]
    
    async def create_study_notes(self, content: str, title: str) -> Dict:
        """Create structured study notes from content"""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.base_url}/api/v1/chat/completions",
                json={
                    "messages": [
                        {
                            "role": "system",
                            "content": """You are a study assistant. Create structured notes with:
                            1. Summary (2-3 sentences)
                            2. Key Concepts (bullet points)
                            3. Important Details
                            4. Questions for Review
                            Format in markdown."""
                        },
                        {
                            "role": "user",
                            "content": f"Title: {title}\n\nContent:\n{content[:4000]}"
                        }
                    ],
                    "max_tokens": 1000
                }
            )
            response.raise_for_status()
            data = response.json()
            notes = data["choices"][0]["message"]["content"]
            
            return {
                "notes": notes,
                "summary": await self.generate_summary(content, 150),
                "key_points": await self.extract_key_points(content, 5)
            }

ai_service = AIServiceClient()
