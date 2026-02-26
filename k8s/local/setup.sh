#!/bin/bash
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
info() { echo -e "${BLUE}[→]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Apex — Local Kubernetes + ArgoCD Setup     ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════╝${NC}"
echo ""

# ============================================
# STEP 1: Install tools via Homebrew
# ============================================
info "Step 1/7: Installing required tools..."

if ! command -v brew &> /dev/null; then
  err "Homebrew not found. Install it: https://brew.sh"
fi

TOOLS=(kubectl kind kustomize argocd helm)
for tool in "${TOOLS[@]}"; do
  if command -v "$tool" &> /dev/null; then
    log "$tool already installed"
  else
    info "Installing $tool..."
    brew install "$tool"
    log "$tool installed"
  fi
done

# Check Docker is running
if ! docker info &> /dev/null; then
  err "Docker is not running. Start Docker Desktop first."
fi
log "Docker is running"

# ============================================
# STEP 2: Create kind cluster
# ============================================
info "Step 2/7: Creating kind cluster..."

if kind get clusters 2>/dev/null | grep -q "apex-local"; then
  warn "Cluster 'apex-local' already exists. Deleting..."
  kind delete cluster --name apex-local
fi

kind create cluster --config "$SCRIPT_DIR/kind-config.yaml" --wait 60s
log "Kind cluster 'apex-local' created"

kubectl cluster-info --context kind-apex-local

# ============================================
# STEP 3: Install NGINX Ingress Controller
# ============================================
info "Step 3/7: Installing NGINX Ingress Controller..."

kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml

info "Waiting for ingress controller to be ready..."
kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=120s

log "NGINX Ingress Controller ready"

# ============================================
# STEP 4: Build and load Docker images into kind
# ============================================
info "Step 4/7: Building Docker images..."

cd "$PROJECT_DIR"

info "Building api-gateway..."
docker build -t apex/api-gateway:latest ./api-gateway
log "api-gateway built"

info "Building user-service..."
docker build -t apex/user-service:latest ./user-service
log "user-service built"

info "Building editor-service..."
docker build -t apex/editor-service:latest ./editor-service
log "editor-service built"

info "Building ai-service (this may take a few minutes — downloading ML model)..."
docker build -t apex/ai-service:latest ./ai-service
log "ai-service built"

info "Loading images into kind cluster..."
kind load docker-image apex/api-gateway:latest --name apex-local
kind load docker-image apex/user-service:latest --name apex-local
kind load docker-image apex/editor-service:latest --name apex-local
kind load docker-image apex/ai-service:latest --name apex-local
log "All images loaded into kind"

# ============================================
# STEP 5: Deploy with Kustomize (local overlay)
# ============================================
info "Step 5/7: Deploying application to Kubernetes..."

cd "$PROJECT_DIR/k8s"

# Create namespace first
kubectl apply -f base/namespace.yaml

# Apply local overlay
kubectl apply -k overlays/local/

log "All manifests applied"

# ============================================
# STEP 6: Wait for everything to come up
# ============================================
info "Step 6/7: Waiting for pods to be ready..."

echo ""
info "Waiting for infrastructure..."

kubectl -n apex wait --for=condition=ready pod -l app=user-postgres --timeout=120s 2>/dev/null || warn "user-postgres not ready yet"
kubectl -n apex wait --for=condition=ready pod -l app=editor-postgres --timeout=120s 2>/dev/null || warn "editor-postgres not ready yet"
kubectl -n apex wait --for=condition=ready pod -l app=ai-postgres --timeout=120s 2>/dev/null || warn "ai-postgres not ready yet"
kubectl -n apex wait --for=condition=ready pod -l app=redis --timeout=60s 2>/dev/null || warn "redis not ready yet"
kubectl -n apex wait --for=condition=ready pod -l app=minio --timeout=60s 2>/dev/null || warn "minio not ready yet"

log "Infrastructure ready"

info "Waiting for application services..."

kubectl -n apex wait --for=condition=ready pod -l app=user-service --timeout=180s 2>/dev/null || warn "user-service not ready yet"
kubectl -n apex wait --for=condition=ready pod -l app=editor-service --timeout=180s 2>/dev/null || warn "editor-service not ready yet"
kubectl -n apex wait --for=condition=ready pod -l app=ai-service --timeout=300s 2>/dev/null || warn "ai-service not ready yet (ML model loading)"
kubectl -n apex wait --for=condition=ready pod -l app=api-gateway --timeout=120s 2>/dev/null || warn "api-gateway not ready yet"

log "Application services ready"

# ============================================
# STEP 7: Install ArgoCD
# ============================================
info "Step 7/7: Installing ArgoCD..."

kubectl create namespace argocd 2>/dev/null || true
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

info "Waiting for ArgoCD to be ready..."
kubectl -n argocd wait --for=condition=ready pod -l app.kubernetes.io/name=argocd-server --timeout=180s

# Get ArgoCD admin password
ARGOCD_PASSWORD=$(kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d)

log "ArgoCD installed"

# ============================================
# DONE
# ============================================
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                    Setup Complete!                           ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BLUE}Application:${NC}"
echo -e "    API Gateway:  ${GREEN}http://localhost:8000${NC}"
echo -e "    Health check: ${GREEN}http://localhost:8000/health${NC}"
echo ""
echo -e "  ${BLUE}ArgoCD Dashboard:${NC}"
echo -e "    Run:      ${YELLOW}kubectl port-forward svc/argocd-server -n argocd 9090:443${NC}"
echo -e "    Open:     ${GREEN}https://localhost:9090${NC}"
echo -e "    User:     ${GREEN}admin${NC}"
echo -e "    Password: ${GREEN}${ARGOCD_PASSWORD}${NC}"
echo ""
echo -e "  ${BLUE}Useful commands:${NC}"
echo -e "    Pods status:    ${YELLOW}kubectl get pods -n apex${NC}"
echo -e "    Logs:           ${YELLOW}kubectl logs -n apex -l app=<service-name> -f${NC}"
echo -e "    ArgoCD login:   ${YELLOW}argocd login localhost:9090 --username admin --password ${ARGOCD_PASSWORD} --insecure${NC}"
echo -e "    Destroy:        ${YELLOW}kind delete cluster --name apex-local${NC}"
echo ""
