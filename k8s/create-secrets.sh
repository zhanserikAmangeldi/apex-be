#!/bin/bash
# ============================================
# Создание секретов для apex-prod на сервере
# Запускай: bash create-secrets.sh
# ============================================

NAMESPACE="apex-prod"

# Генерация паролей
JWT_SECRET=$(openssl rand -hex 32)
DB_PASS_USER=$(openssl rand -hex 16)
DB_PASS_EDITOR=$(openssl rand -hex 16)
DB_PASS_AI=$(openssl rand -hex 16)
DB_PASS_SCRAPER=$(openssl rand -hex 16)
MINIO_PASS=$(openssl rand -hex 16)
ENCRYPTION_KEY=$(openssl rand -hex 16)

echo "=== Generating secrets for namespace: $NAMESPACE ==="
echo ""
echo "========== SAVE THESE PASSWORDS =========="
echo "JWT_SECRET:      $JWT_SECRET"
echo "DB_PASS_USER:    $DB_PASS_USER"
echo "DB_PASS_EDITOR:  $DB_PASS_EDITOR"
echo "DB_PASS_AI:      $DB_PASS_AI"
echo "DB_PASS_SCRAPER: $DB_PASS_SCRAPER"
echo "MINIO_PASS:      $MINIO_PASS"
echo "ENCRYPTION_KEY:  $ENCRYPTION_KEY"
echo "==========================================="
echo ""

# --- Postgres secrets ---
kubectl create secret generic user-postgres-secret -n $NAMESPACE \
  --from-literal=POSTGRES_DB=user_service \
  --from-literal=POSTGRES_USER=user-service \
  --from-literal=POSTGRES_PASSWORD=$DB_PASS_USER \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl create secret generic editor-postgres-secret -n $NAMESPACE \
  --from-literal=POSTGRES_DB=editor_service \
  --from-literal=POSTGRES_USER=editor-service \
  --from-literal=POSTGRES_PASSWORD=$DB_PASS_EDITOR \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl create secret generic ai-postgres-secret -n $NAMESPACE \
  --from-literal=POSTGRES_DB=ai_service \
  --from-literal=POSTGRES_USER=ai-service \
  --from-literal=POSTGRES_PASSWORD=$DB_PASS_AI \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl create secret generic scraper-postgres-secret -n $NAMESPACE \
  --from-literal=POSTGRES_DB=scraper_db \
  --from-literal=POSTGRES_USER=scraper \
  --from-literal=POSTGRES_PASSWORD=$DB_PASS_SCRAPER \
  --dry-run=client -o yaml | kubectl apply -f -

# --- MinIO ---
kubectl create secret generic minio-secret -n $NAMESPACE \
  --from-literal=MINIO_ROOT_USER=admin \
  --from-literal=MINIO_ROOT_PASSWORD=$MINIO_PASS \
  --dry-run=client -o yaml | kubectl apply -f -

# --- API Gateway ---
kubectl create secret generic api-gateway-secret -n $NAMESPACE \
  --from-literal=JWT_SECRET=$JWT_SECRET \
  --dry-run=client -o yaml | kubectl apply -f -

# --- User Service ---
# ЗАМЕНИ значения SMTP и email на свои реальные!
kubectl create secret generic user-service-secret -n $NAMESPACE \
  --from-literal=DB_USER=user-service \
  --from-literal=DB_PASSWORD=$DB_PASS_USER \
  --from-literal=JWT_SECRET=$JWT_SECRET \
  --from-literal=SMTP_HOST=smtp.gmail.com \
  --from-literal=SMTP_USER=ЗАМЕНИ_НА_СВОЙ_EMAIL \
  --from-literal=SMTP_PASSWORD=ЗАМЕНИ_НА_СВОЙ_APP_PASSWORD \
  --from-literal=SMTP_FROM=noreply@zham.space \
  --from-literal=MINIO_USER=admin \
  --from-literal=MINIO_PASSWORD=$MINIO_PASS \
  --dry-run=client -o yaml | kubectl apply -f -

# --- Editor Service ---
kubectl create secret generic editor-service-secret -n $NAMESPACE \
  --from-literal=DB_USER=editor-service \
  --from-literal=DB_PASSWORD=$DB_PASS_EDITOR \
  --from-literal=JWT_SECRET=$JWT_SECRET \
  --from-literal=MINIO_ACCESS_KEY=admin \
  --from-literal=MINIO_SECRET_KEY=$MINIO_PASS \
  --dry-run=client -o yaml | kubectl apply -f -

# --- AI Service ---
# ЗАМЕНИ API ключи на свои реальные!
kubectl create secret generic ai-service-secret -n $NAMESPACE \
  --from-literal=DB_USER=ai-service \
  --from-literal=DB_PASSWORD=$DB_PASS_AI \
  --from-literal=JWT_SECRET=$JWT_SECRET \
  --from-literal=YOUTUBE_API_KEY=ЗАМЕНИ_НА_СВОЙ_YOUTUBE_KEY \
  --from-literal=OPENAI_API_KEY=ЗАМЕНИ_НА_СВОЙ_OPENAI_KEY \
  --from-literal=DEEPSEEK_API_KEY=ЗАМЕНИ_НА_СВОЙ_DEEPSEEK_KEY \
  --dry-run=client -o yaml | kubectl apply -f -

# --- Content Scraper ---
kubectl create secret generic content-scraper-secret -n $NAMESPACE \
  --from-literal=DATABASE_URL="postgresql+asyncpg://scraper:${DB_PASS_SCRAPER}@scraper-postgres:5432/scraper_db" \
  --from-literal=ENCRYPTION_KEY=$ENCRYPTION_KEY \
  --from-literal=JWT_SECRET=$JWT_SECRET \
  --dry-run=client -o yaml | kubectl apply -f -

echo ""
echo "=== All secrets created! ==="
echo ""
echo "IMPORTANT: Replace these placeholders with real values:"
echo "  - SMTP_USER / SMTP_PASSWORD in user-service-secret"
echo "  - YOUTUBE_API_KEY in ai-service-secret"
echo "  - OPENAI_API_KEY in ai-service-secret"
echo "  - DEEPSEEK_API_KEY in ai-service-secret"
echo ""
echo "To update a secret, re-run the kubectl create command with real values."
echo ""
echo "After updating secrets, restart pods:"
echo "  kubectl rollout restart deployment -n $NAMESPACE"
echo "  kubectl rollout restart statefulset -n $NAMESPACE"
