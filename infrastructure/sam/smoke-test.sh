#!/usr/bin/env bash
# Smoke test do sam-lab pela API: usuário temporário no Cognito do lab,
# produto pelo catálogo, pedido pela API .NET e processamento pela fila.
# O usuário é apagado no fim, mesmo se o teste falhar.
#
# Uso: bash infrastructure/sam/smoke-test.sh [stack]
set -euo pipefail

STACK=${1:-residencia-foundation-sam-lab}
export AWS_PAGER=""
output() {
  aws cloudformation describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" --output text
}
API=$(output ApiUrl)
POOL=$(output UserPoolId)
CLIENT=$(output UserPoolClientId)

EMAIL="smoke-${GITHUB_RUN_ID:-local}-$(date +%s)@example.com"
PASSWORD="Sm0ke-$(openssl rand -hex 12)A"
cleanup() { aws cognito-idp admin-delete-user --user-pool-id "$POOL" --username "$EMAIL" >/dev/null 2>&1 || true; }
trap cleanup EXIT

aws cognito-idp admin-create-user --user-pool-id "$POOL" --username "$EMAIL" \
  --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true \
  --message-action SUPPRESS >/dev/null
aws cognito-idp admin-set-user-password --user-pool-id "$POOL" --username "$EMAIL" \
  --password "$PASSWORD" --permanent
TOKEN=$(aws cognito-idp admin-initiate-auth --user-pool-id "$POOL" --client-id "$CLIENT" \
  --auth-flow ADMIN_USER_PASSWORD_AUTH --auth-parameters "USERNAME=$EMAIL,PASSWORD=$PASSWORD" \
  --query AuthenticationResult.IdToken --output text)
echo "Usuário temporário autenticado no User Pool do lab ($POOL)"

call() { # método, caminho, [corpo]
  curl --fail-with-body --silent --show-error -X "$1" "${API}$2" \
    -H "Authorization: $TOKEN" -H 'Content-Type: application/json' ${3:+--data "$3"}
}

echo "Sem token a API recusa: HTTP $(curl -s -o /dev/null -w '%{http_code}' "${API}/products")"

PRODUCT_ID=$(call POST /products '{"name":"Produto smoke test","description":"sam-lab","priceCents":1990,"stock":5}' | jq -r '.product.id')
echo "Produto criado: $PRODUCT_ID"

ORDER=$(call POST /orders "{\"productId\":\"$PRODUCT_ID\",\"quantity\":1}")
ORDER_ID=$(jq -r '.orderId' <<<"$ORDER")
echo "Pedido criado: $ORDER_ID (status $(jq -r '.status' <<<"$ORDER"))"

for _ in $(seq 1 30); do
  STATUS=$(call GET /orders | jq -r --arg id "$ORDER_ID" '.items[] | select(.id == $id) | .status')
  [[ "$STATUS" == processed ]] && break
  sleep 2
done
echo "Pedido $ORDER_ID após a fila: status $STATUS"
[[ "$STATUS" == processed ]] || { echo "::error::pedido não foi processado"; exit 1; }
echo "Smoke test OK: catálogo, API de pedidos, SQS e processador do sam-lab"
