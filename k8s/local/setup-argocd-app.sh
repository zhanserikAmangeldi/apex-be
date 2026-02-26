#!/bin/bash
set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}[→]${NC} $1"; }
log()  { echo -e "${GREEN}[✓]${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo ""
echo -e "${BLUE}Setting up ArgoCD Application for local testing...${NC}"
echo ""

# Get ArgoCD password
ARGOCD_PASSWORD=$(kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d)

# Port-forward ArgoCD in background
info "Starting ArgoCD port-forward..."
kubectl port-forward svc/argocd-server -n argocd 9090:443 &>/dev/null &
PF_PID=$!
sleep 3

# Login to ArgoCD
info "Logging into ArgoCD..."
argocd login localhost:9090 \
  --username admin \
  --password "$ARGOCD_PASSWORD" \
  --insecure

# Get the git remote URL (if available)
GIT_URL=$(cd "$PROJECT_DIR" && git remote get-url origin 2>/dev/null || echo "")

if [ -z "$GIT_URL" ]; then
  info "No git remote found. Creating ArgoCD app from local path..."

  # For local testing without git, we apply the ArgoCD Application directly
  # pointing to the local overlay that's already deployed
  cat <<EOF | kubectl apply -f -
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: apex-local
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/placeholder/apex-be.git
    targetRevision: HEAD
    path: k8s/overlays/local
  destination:
    server: https://kubernetes.default.svc
    namespace: apex
  syncPolicy:
    syncOptions:
      - CreateNamespace=true
EOF

  log "ArgoCD Application created (placeholder — manifests already deployed via kustomize)"
  echo ""
  echo -e "  ${YELLOW}Note:${NC} Since there's no git remote, ArgoCD shows the app but"
  echo -e "  can't sync from git. To fully test ArgoCD sync:"
  echo -e "  1. Push your code to a git repo"
  echo -e "  2. Run: ${YELLOW}argocd app set apex-local --repo <your-git-url>${NC}"
  echo ""
else
  info "Git remote found: $GIT_URL"
  BRANCH=$(cd "$PROJECT_DIR" && git branch --show-current)

  argocd app create apex-local \
    --repo "$GIT_URL" \
    --path k8s/overlays/local \
    --dest-server https://kubernetes.default.svc \
    --dest-namespace apex \
    --revision "$BRANCH" \
    --sync-option CreateNamespace=true \
    --sync-policy automated \
    --self-heal \
    --auto-prune

  log "ArgoCD Application 'apex-local' created and syncing from $GIT_URL ($BRANCH)"
fi

# Cleanup port-forward
kill $PF_PID 2>/dev/null || true

echo ""
echo -e "${GREEN}Done!${NC} Open ArgoCD dashboard:"
echo -e "  ${YELLOW}kubectl port-forward svc/argocd-server -n argocd 9090:443${NC}"
echo -e "  ${GREEN}https://localhost:9090${NC}"
echo -e "  User: admin / Password: $ARGOCD_PASSWORD"
echo ""
