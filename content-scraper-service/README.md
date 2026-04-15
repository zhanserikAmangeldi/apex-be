# Content Scraper Service

Микросервис для парсинга веб-контента с поддержкой авторизованных сайтов, AI-обработки и автоматического создания конспектов.

## 🎯 Возможности

### Core Features
- **Public Scraping**: Парсинг публичных сайтов без авторизации
- **Authenticated Scraping**: Парсинг сайтов с авторизацией через сохраненные сессии
- **Session Management**: Безопасное хранение cookies и session tokens (AES-256)
- **Content Extraction**: Извлечение чистого текста из HTML (trafilatura)

### AI Integration ✨
- **Auto Summary**: Автоматическая генерация краткого содержания
- **Key Points**: Извлечение основных пунктов
- **Study Notes**: Создание структурированных конспектов
- **Vector Search**: Поиск по контенту через embeddings

### Editor Integration 📝
- **Auto Document Creation**: Автоматическое создание документов
- **Smart Formatting**: Форматирование с AI notes
- **Auto Tagging**: Автоматические теги (web-content, self-study, ai-processed)
- **Vault Organization**: Организация по vaults

### Background Processing 🔄
- **Periodic Scraping**: Автоматическое обновление контента (Celery)
- **Embeddings Generation**: Фоновая генерация векторов для поиска
- **Scheduled Updates**: Проверка обновлений каждые 30 минут

## Архитектура

```
Browser Extension → API → Scraper Strategy → [Public/Auth Scraper] → Database
                                                                    ↓
                                                              Editor Service
```

## Установка

### 1. Установить зависимости

```bash
cd content-scraper-service
pip install -r requirements.txt
playwright install chromium
```

### 2. Настроить переменные окружения

```bash
cp .env.example .env
# Отредактировать .env
```

### 3. Запустить миграции

```bash
psql -U scraper -d scraper_db -f migrations/001_init.sql
```

### 4. Запустить сервис

```bash
uvicorn app.main:app --reload --port 8003
```

## API Endpoints

### Sessions

**POST /api/v1/sessions/capture**
Сохранить сессию из browser extension

```json
{
  "user_id": "uuid",
  "domain": "example.com",
  "cookies": [...]
}
```

**GET /api/v1/sessions/{user_id}**
Получить все сохраненные сессии пользователя

**DELETE /api/v1/sessions/{session_id}**
Удалить сохраненную сессию

### Scraping

**POST /api/v1/scrape**
Спарсить URL с AI обработкой и созданием документа

```json
{
  "user_id": "uuid",
  "url": "https://example.com/article",
  "vault_id": "uuid",
  "periodic": false,
  "interval_hours": 24,
  "create_document": true,
  "generate_ai_notes": true
}
```

Response:
```json
{
  "content_id": "uuid",
  "document_id": "uuid",
  "title": "Article Title",
  "ai_summary": "AI-generated summary...",
  "status": "success"
}
```

**GET /api/v1/content/{content_id}**
Получить спарсенный контент

**GET /api/v1/content/user/{user_id}**
Получить весь контент пользователя

### Search

**POST /api/v1/search**
Векторный поиск по контенту

```json
{
  "query": "machine learning basics",
  "user_id": "uuid",
  "limit": 10
}
```

Response:
```json
[
  {
    "id": "uuid",
    "title": "ML Tutorial",
    "url": "https://...",
    "ai_summary": "...",
    "similarity": 0.87,
    "matched_text": "..."
  }
]
```

## Docker

```bash
# Start all services
docker-compose up -d content-scraper-service celery-worker celery-beat

# Check logs
docker-compose logs -f content-scraper-service
docker-compose logs -f celery-worker
```

## Интеграции

### С AI Service
- Автоматическая генерация summary и key points
- Создание структурированных study notes
- Генерация embeddings для векторного поиска

### С Editor Service
- Автоматическое создание документов
- Форматирование с AI notes
- Добавление тегов и организация по vaults

### Celery для фоновых задач
- Периодический парсинг контента
- Генерация embeddings
- Проверка обновлений

Подробнее: `../CONTENT_SCRAPER_INTEGRATIONS.md`
