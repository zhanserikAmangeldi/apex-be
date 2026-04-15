from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime


# --- Requests ---

class EmbedRequest(BaseModel):
    document_id: UUID
    vault_id: UUID
    title: str = ""
    content: str


class SemanticSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=2000)
    vault_id: UUID
    limit: int = Field(default=10, ge=1, le=50)
    min_score: float = Field(default=0.35, ge=0.0, le=1.0)


class BatchEmbedRequest(BaseModel):
    documents: list[EmbedRequest]


# --- Responses ---

class EmbeddingResponse(BaseModel):
    document_id: UUID
    created: bool
    content_hash: str


class SearchResult(BaseModel):
    document_id: UUID
    title: str
    score: float


class SemanticSearchResponse(BaseModel):
    query: str
    results: list[SearchResult]
    count: int


class HealthResponse(BaseModel):
    model_config = {"protected_namespaces": ()}

    status: str
    service: str
    model_loaded: bool
    timestamp: datetime


# --- Chat Models ---

class ChatMessage(BaseModel):
    role: str  # 'user', 'assistant', 'system'
    content: str
    metadata: dict = {}


class ChatRequest(BaseModel):
    document_id: UUID
    message: str = Field(..., min_length=1, max_length=5000)
    session_id: UUID | None = None
    include_videos: bool = True


class ChatResponse(BaseModel):
    session_id: UUID
    message: ChatMessage
    videos: list["VideoResult"] = []


class ChatSession(BaseModel):
    id: UUID
    document_id: UUID
    title: str
    created_at: datetime
    updated_at: datetime
    messages: list[ChatMessage] = []


# --- Video Models ---

class VideoResult(BaseModel):
    video_id: str
    title: str
    description: str
    thumbnail_url: str
    channel_title: str
    published_at: str
    duration: str | None = None
    view_count: int | None = None


class VideoSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=500)
    max_results: int = Field(default=5, ge=1, le=20)


class VideoSearchResponse(BaseModel):
    query: str
    videos: list[VideoResult]
    count: int


# --- Flashcard Models ---

class FlashcardGenerateRequest(BaseModel):
    document_id: UUID
    vault_id: UUID
    title: str = ""
    content: str


class Flashcard(BaseModel):
    id: UUID
    document_id: UUID
    vault_id: UUID
    front: str
    back: str
    ease_factor: float
    interval_days: int
    reps: int
    next_review: datetime
    created_at: datetime


class FlashcardGenerateResponse(BaseModel):
    document_id: UUID
    cards: list[Flashcard]
    count: int


class FlashcardVaultGenerateResponse(BaseModel):
    vault_id: UUID
    cards: list[Flashcard]
    total_cards: int
    documents_processed: int
    documents_skipped: int


class FlashcardReviewRequest(BaseModel):
    quality: int = Field(..., ge=0, le=5)


class FlashcardReviewResponse(BaseModel):
    id: UUID
    ease_factor: float
    interval_days: int
    reps: int
    next_review: datetime


class FlashcardListResponse(BaseModel):
    cards: list[Flashcard]
    total: int
    due: int


# --- Quiz Models ---

class QuizGenerateRequest(BaseModel):
    vault_id: UUID
    num_questions: int = Field(default=10, ge=1, le=30)


class QuizOption(BaseModel):
    text: str
    is_correct: bool


class QuizQuestion(BaseModel):
    document_id: UUID
    question: str
    options: list[QuizOption]
    topic: str


class QuizGenerateResponse(BaseModel):
    questions: list[QuizQuestion]
    count: int


class QuizAnswerItem(BaseModel):
    document_id: UUID
    question: str
    correct: bool


class QuizSubmitRequest(BaseModel):
    vault_id: UUID
    answers: list[QuizAnswerItem]


class QuizSubmitResponse(BaseModel):
    total: int
    correct: int
    xp_earned: int
    accuracy: float


# --- Progress Models ---

class TopicProgress(BaseModel):
    topic: str
    attempts: int
    correct: int
    accuracy: float
    xp: int
    status: str  # 'strong', 'review', 'weak'


class RecommendedNote(BaseModel):
    document_id: UUID
    title: str
    score: float


class AdaptiveRecommendation(BaseModel):
    topic: str
    accuracy: float
    related_notes: list[RecommendedNote]


class ProgressDashboardResponse(BaseModel):
    topic_progress: list[TopicProgress]
    total_xp: int
    total_reviews: int
    cards_due: int
    recommendations: list[AdaptiveRecommendation]


# --- Study Streaks ---

class StreakResponse(BaseModel):
    current_streak: int
    longest_streak: int
    today_done: bool
    total_study_days: int


# --- Spaced Repetition Forecast ---

class ForecastDay(BaseModel):
    date: str  # YYYY-MM-DD
    cards_due: int


class ForecastResponse(BaseModel):
    forecast: list[ForecastDay]
    total_due_7d: int


# --- Extended Quiz Question Types ---

class QuizTFQuestion(BaseModel):
    document_id: UUID
    statement: str
    is_true: bool
    topic: str
    question_type: str = "true_false"


class QuizFillQuestion(BaseModel):
    document_id: UUID
    sentence_with_blank: str
    answer: str
    topic: str
    question_type: str = "fill_blank"


class MixedQuizQuestion(BaseModel):
    document_id: UUID
    question_type: str  # 'multiple_choice', 'true_false', 'fill_blank'
    question: str
    options: list[QuizOption] | None = None  # for MC
    is_true: bool | None = None  # for TF
    answer: str | None = None  # for fill_blank
    topic: str


class MixedQuizGenerateResponse(BaseModel):
    questions: list[MixedQuizQuestion]
    count: int


class MixedQuizAnswerItem(BaseModel):
    document_id: UUID
    question: str
    question_type: str
    correct: bool


class MixedQuizSubmitRequest(BaseModel):
    vault_id: UUID
    answers: list[MixedQuizAnswerItem]


# --- Spaced Reading ---

class ReadingItem(BaseModel):
    document_id: UUID
    title: str
    vault_id: UUID
    interval_days: int
    next_review: datetime
    last_read_at: datetime | None
    reason: str  # 'due', 'low_accuracy', 'never_read'


class ReadingListResponse(BaseModel):
    items: list[ReadingItem]
    total_due: int
