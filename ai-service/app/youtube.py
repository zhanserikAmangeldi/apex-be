import logging
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from app.config import settings
from app.models import VideoResult

logger = logging.getLogger("ai-service")


class YouTubeClient:
    def __init__(self):
        self.api_key = settings.youtube_api_key
        if not self.api_key:
            logger.warning("YouTube API key not configured")
            self.youtube = None
        else:
            self.youtube = build('youtube', 'v3', developerKey=self.api_key)

    def search_videos(self, query: str, max_results: int = 5) -> list[VideoResult]:
        if not self.youtube:
            logger.error("YouTube API not initialized")
            return []

        try:
            search_response = self.youtube.search().list(
                q=query,
                part='id,snippet',
                maxResults=max_results,
                type='video',
                relevanceLanguage='en',
                safeSearch='moderate',
                videoEmbeddable='true',
                order='relevance'
            ).execute()

            video_ids = [item['id']['videoId'] for item in search_response.get('items', [])]
            
            if not video_ids:
                return []

            videos_response = self.youtube.videos().list(
                part='contentDetails,statistics',
                id=','.join(video_ids)
            ).execute()

            video_details = {
                item['id']: item
                for item in videos_response.get('items', [])
            }

            results = []
            for item in search_response.get('items', []):
                video_id = item['id']['videoId']
                snippet = item['snippet']
                details = video_details.get(video_id, {})
                
                results.append(VideoResult(
                    video_id=video_id,
                    title=snippet['title'],
                    description=snippet['description'],
                    thumbnail_url=snippet['thumbnails']['high']['url'],
                    channel_title=snippet['channelTitle'],
                    published_at=snippet['publishedAt'],
                    duration=details.get('contentDetails', {}).get('duration'),
                    view_count=int(details.get('statistics', {}).get('viewCount', 0))
                ))

            return results

        except HttpError as e:
            logger.error(f"YouTube API error: {e}")
            return []
        except Exception as e:
            logger.error(f"Unexpected error searching YouTube: {e}")
            return []


_youtube_client = None


def get_youtube_client() -> YouTubeClient:
    global _youtube_client
    if _youtube_client is None:
        _youtube_client = YouTubeClient()
    return _youtube_client
