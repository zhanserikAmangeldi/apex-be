#!/bin/bash
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo -e "${RED}Destroying local Kubernetes cluster...${NC}"
echo ""

if kind get clusters 2>/dev/null | grep -q "apex-local"; then
  kind delete cluster --name apex-local
  echo -e "${GREEN}[✓]${NC} Cluster 'apex-local' deleted"
else
  echo -e "${YELLOW}[!]${NC} Cluster 'apex-local' not found"
fi

echo ""
echo -e "To also remove Docker images:"
echo -e "  ${YELLOW}docker rmi apex/api-gateway:latest apex/user-service:latest apex/editor-service:latest apex/ai-service:latest${NC}"
echo ""
