#!/usr/bin/env bash
# Bootstrap único do ambiente sam-lab (fora da pipeline). Idempotente.
#
# Cria:
#   - bucket de artefatos do SAM (privado, expira objetos em 30 dias)
#   - permissions boundary das roles das funções do lab
#   - role de execução do CloudFormation (cria/altera os recursos da stack)
#   - role da pipeline via OIDC (só gerencia a stack; não cria recursos direto)
#
# Não cria nem altera VPC, banco, Lambdas, API ou Cognito do ambiente principal:
# os IDs da API e do User Pool de produção entram em Deny explícito.
#
# Uso:
#   export AWS_PROFILE=residencia_aws AWS_REGION=us-east-1
#   bash infrastructure/sam/bootstrap.sh ramirescm/residencia-trilha-foundation
set -euo pipefail

REPO=${1:?informe owner/repo}
REGION=${AWS_REGION:?defina AWS_REGION}
export AWS_PAGER=""
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

ARTIFACTS_BUCKET="residencia-foundation-sam-artifacts-${ACCOUNT_ID}"
BOUNDARY_NAME=residencia-foundation-sam-lab-boundary
BOUNDARY_ARN="arn:aws:iam::${ACCOUNT_ID}:policy/${BOUNDARY_NAME}"
EXEC_ROLE=residencia-foundation-sam-cfn-exec
DEPLOY_ROLE=residencia-foundation-sam-deploy

# sub do token OIDC com IDs imutáveis de owner e repositório, como nas outras roles.
REPO_SUB=$(gh api "repos/${REPO}" --jq '"\(.owner.login)@\(.owner.id)/\(.name)@\(.id)"')
PROD_REST_API_ID=$(aws apigateway get-rest-apis --query "items[?name=='residencia-foundation-rest-api'].id | [0]" --output text)
PROD_USER_POOL_ID=$(aws cognito-idp list-user-pools --max-results 60 --query "UserPools[?Name=='residencia-foundation-users'].Id | [0]" --output text)
for v in REPO_SUB PROD_REST_API_ID PROD_USER_POOL_ID; do
  [[ -n "${!v}" && "${!v}" != "None" ]] || { echo "não encontrei $v" >&2; exit 1; }
done

render() {
  sed -e "s|__ACCOUNT_ID__|${ACCOUNT_ID}|g" -e "s|__REGION__|${REGION}|g" \
      -e "s|__REPO_SUB__|${REPO_SUB}|g" -e "s|__PROD_REST_API_ID__|${PROD_REST_API_ID}|g" \
      -e "s|__PROD_USER_POOL_ID__|${PROD_USER_POOL_ID}|g" "${DIR}/policies/$1"
}
upsert_role() { # nome, arquivo de trust, arquivo de permissions, descrição
  if aws iam get-role --role-name "$1" >/dev/null 2>&1; then
    aws iam update-assume-role-policy --role-name "$1" --policy-document "$(render "$2")"
  else
    aws iam create-role --role-name "$1" --description "$4" \
      --assume-role-policy-document "$(render "$2")" --max-session-duration 3600 >/dev/null
  fi
  aws iam put-role-policy --role-name "$1" --policy-name "${1}-policy" --policy-document "$(render "$3")"
  echo "role: arn:aws:iam::${ACCOUNT_ID}:role/$1"
}

echo "### Bucket de artefatos: ${ARTIFACTS_BUCKET}"
if ! aws s3api head-bucket --bucket "$ARTIFACTS_BUCKET" 2>/dev/null; then
  if [[ "$REGION" == us-east-1 ]]; then
    aws s3api create-bucket --bucket "$ARTIFACTS_BUCKET" >/dev/null
  else
    aws s3api create-bucket --bucket "$ARTIFACTS_BUCKET" --create-bucket-configuration "LocationConstraint=${REGION}" >/dev/null
  fi
fi
aws s3api put-public-access-block --bucket "$ARTIFACTS_BUCKET" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-lifecycle-configuration --bucket "$ARTIFACTS_BUCKET" --lifecycle-configuration \
  '{"Rules":[{"ID":"expira-artefatos","Status":"Enabled","Filter":{},"Expiration":{"Days":30},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":1}}]}'

echo "### Permissions boundary: ${BOUNDARY_NAME}"
if aws iam get-policy --policy-arn "$BOUNDARY_ARN" >/dev/null 2>&1; then
  # Mantém no máximo 5 versões: apaga a mais antiga não-default antes de criar outra.
  old=$(aws iam list-policy-versions --policy-arn "$BOUNDARY_ARN" \
    --query 'Versions[?!IsDefaultVersion] | sort_by(@,&CreateDate)[0].VersionId' --output text)
  count=$(aws iam list-policy-versions --policy-arn "$BOUNDARY_ARN" --query 'length(Versions)' --output text)
  [[ "$count" -ge 5 && "$old" != "None" ]] && aws iam delete-policy-version --policy-arn "$BOUNDARY_ARN" --version-id "$old"
  aws iam create-policy-version --policy-arn "$BOUNDARY_ARN" --policy-document "$(render boundary.json)" --set-as-default >/dev/null
else
  aws iam create-policy --policy-name "$BOUNDARY_NAME" \
    --description "Limite máximo das roles das funções do sam-lab" \
    --policy-document "$(render boundary.json)" >/dev/null
fi

echo "### Role de execução do CloudFormation"
upsert_role "$EXEC_ROLE" cfn-exec-trust.json cfn-exec-permissions.json \
  "Usada pelo CloudFormation para criar os recursos da stack residencia-foundation-sam-lab"

echo "### Role da pipeline (OIDC, environment sam-lab)"
upsert_role "$DEPLOY_ROLE" deploy-trust.json deploy-permissions.json \
  "GitHub Actions (environment sam-lab): gerencia só a stack residencia-foundation-sam-lab"

cat <<EOF

### Repository Variables para o GitHub
gh variable set SAM_ROLE_ARN          --repo ${REPO} --body arn:aws:iam::${ACCOUNT_ID}:role/${DEPLOY_ROLE}
gh variable set SAM_CFN_EXEC_ROLE_ARN --repo ${REPO} --body arn:aws:iam::${ACCOUNT_ID}:role/${EXEC_ROLE}
gh variable set SAM_ARTIFACTS_BUCKET  --repo ${REPO} --body ${ARTIFACTS_BUCKET}
gh variable set SAM_BOUNDARY_ARN      --repo ${REPO} --body ${BOUNDARY_ARN}
EOF
