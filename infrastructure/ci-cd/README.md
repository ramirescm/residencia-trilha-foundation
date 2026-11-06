# Sprint 4 — entrega contínua em três fases

Os workflows oficiais ficam em `.github/workflows/frontend.yml` e
`.github/workflows/backend.yml`. As policies IAM ficam em `infrastructure/ci-cd/`.
Configure as roles e Repository Variables antes de executar as pipelines.
Depois de publicados na main, os workflows executam a cada push nessa branch
ou por execução manual. Não use access keys permanentes.

## 1. AWS: OIDC, roles e policies

- Reutilize o provider `https://token.actions.githubusercontent.com`, audience
  `sts.amazonaws.com`. Não exclua um provider compartilhado.
- Edite `trust-policy.json`: conta e `repo:SEU-USUARIO/residencia-trilha-foundation:ref:refs/heads/main`.
- Confira o formato de `sub` do seu repositório: conforme a [documentação do GitHub](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws), repositórios novos ou com subject imutável habilitado usam `repo:OWNER@OWNER_ID/REPO@REPO_ID:ref:refs/heads/main`. Nesse caso, substitua o valor do modelo pelo formato com os IDs reais. Preserve a restrição à main e a audience `sts.amazonaws.com`; não use curingas para contornar erros.
- Crie duas roles: frontend e backend. Ambas usam a trust restrita à main.
- Frontend: `permissions-policy.json`, substituindo conta, bucket e distribuição.
- Backend: `backend-permissions-policy.json`, substituindo região, conta e nomes
  das três funções. Só GetFunction/GetFunctionConfiguration/UpdateFunctionCode.
- As funções precisam existir, usar ZIP, arm64 e Node.js 24 / .NET 8, conforme
  o código. API Gateway e SQS devem apontar para essas funções sem alias/version.
  Integrações que usam aliases precisam de uma estratégia de promoção adicional.

Antes de criar as roles, consulte a configuração do seu fork no terminal autenticado
com `gh auth login`:

```bash
gh api "repos/$RESIDENCIA_REPO/actions/oidc/customization/sub"
```

Se a resposta tiver `sub_claim_prefix`, copie esse valor e acrescente
`:ref:refs/heads/main` no campo `token.actions.githubusercontent.com:sub` do JSON.
Exemplo: `repo:usuario@123/repositorio@456:ref:refs/heads/main`.
Se o subject padrão não usar IDs imutáveis, use `repo:USUARIO/REPOSITORIO:ref:refs/heads/main`.
Uma configuração personalizada (`use_default: false`) exige revisar seus claims;
não troque a configuração de um repositório compartilhado para contornar o erro.

## 2. Pipeline do frontend

Workflow oficial: [frontend.yml](../../.github/workflows/frontend.yml).

Repository Variables: `AWS_REGION`, `AWS_ROLE_ARN`, `FRONTEND_BUCKET`,
`CLOUDFRONT_DISTRIBUTION_ID`, `FRONTEND_URL`, `VITE_AWS_REGION`,
`VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`, `VITE_API_URL`.
As VITE_* são públicas; nunca coloque senhas ou segredos nelas.

O frontend executa em push na main ou manualmente por `workflow_dispatch`.
Para execução manual, selecione a main; outras branches não fazem deploy.
O job build lê o repositório com `contents: read`, gera o dist e salva o artefato.
O job deploy baixa esse artefato e solicita OIDC com `id-token: write`.
Essa permissão emite o token; as autorizações de S3/CloudFront vêm da role IAM.
O deploy usa `aws s3 sync dist/`, sem `--delete`, invalida o CloudFront e aguarda
a conclusão. Depois confere a página e o SHA em release.json.
O sync é simples, mas não é uma publicação atômica. Não há garantia de HTML
por último; para este laboratório, mantemos os assets antigos e usamos no-cache.

## 3. Pipeline do backend

Workflow oficial: [backend.yml](../../.github/workflows/backend.yml).

Executa em push na main ou manualmente por `workflow_dispatch`, selecionando
a main. Não executa no PR. Build e Deploy ficam separados por um artefato.
`contents: read` permite o checkout no build; `id-token: write` fica somente
no deploy para autenticação OIDC. O grupo de concorrência serializa os runs.

Repository Variables: `AWS_REGION`, `BACKEND_AWS_ROLE_ARN`, `CATALOG_FUNCTION`,
`ORDER_API_FUNCTION`, `ORDER_PROCESSOR_FUNCTION`.
Defaults do catch-up: `residencia-fdn-catalog-api`, `residencia-fdn-order-api`,
`residencia-fdn-order-processor`. Confira na sua conta antes de usá-los.

O build empacota três ZIPs, valida TypeScript e roda testes
reais contra PostgreSQL local. Não usa a AWS para esses testes.
O manifesto registra o commit e SHA-256 de cada ZIP; o artefato fica guardado
por 30 dias. O job de deploy não recompila código nem executa migrações.

Os comandos de deploy ficam nos blocos `run` do próprio YAML, sem executar
`deploy.mjs`. Primeiro conferem os três ZIPs e o commit. Cada Lambda tem um
step com `aws lambda update-function-code` e espera da atualização. Ao final,
um único step compara `CodeSha256` das três funções com o manifesto.
Não há conferência prévia dos destinos nem bloqueio por RevisionId; confira
os nomes nas Repository Variables e evite alterações manuais durante o deploy.
Se houver falha, o workflow para: não há rollback automático. As funções
publicadas nos steps anteriores podem já estar na versão nova. Confira os
logs e hashes, corrija a causa e execute novamente na main. Para reverter uma
mudança funcional, faça um commit de reversão e publique as três funções.
O script antigo permanece no repositório para referência, mas não vai no artefato.

O deploy das três funções **não é atômico**: existe uma janela com versões
diferentes. Mantenha contratos e schema retrocompatíveis. As pipelines front e
back também são independentes. Mudança de runtime, configuração, infraestrutura
ou schema é outro procedimento revisado, não uma permissão extra nessa role.

### SAM e catch-up

O template [marketplace-backend-rds.yaml](../catch-up/components/marketplace-backend-rds.yaml)
define a infraestrutura da Sprint 3, incluindo integrações API/SQS e acesso ao
Proxy. O [bootstrap](../catch-up/README.md) provisiona e
inicializa esse ambiente. SAM não importa automaticamente recursos manuais.
Se você fez a Sprint 3 pelo console, use os nomes existentes na pipeline; não
rode catch-up por cima deles. Os nomes das funções do laboratório são fixos,
portanto duas cópias do catch-up na mesma região/conta podem conflitar.

Após publicar código por pipeline, reaplicar o template SAM pode republicar os
ZIPs locais e sobrescrever essa release. Revise sempre antes de reaplicar.
O script de pipeline não altera variáveis, VPC, banco, Cognito, filas ou IAM.

### Validação e recuperação

```bash
bash backend/package.sh
npm --prefix backend/lambdas/01-catalog-backend-api-lambda run check
npm --prefix backend/lambdas/03-order-processor-lambda run check
node --test backend/tests/deploy.test.mjs
POSTGRES_BIN=/caminho/postgresql16/bin bash backend/test-rds-local.sh
```

Após um deploy, valide login, produto, imagem, pedido, consumo da fila e estoque.
Hashes e LastUpdateStatus comprovam publicação, não comportamento funcional.
O script `backend/test-deployed.sh` existente foi escrito para DynamoDB e sua
limpeza não é apropriada ao modo RDS; não o utilize nesse baseline.

Para rollback após um deploy bem-sucedido, use `git revert` no commit da mudança
e faça `git push origin main` para executar novamente Build e Deploy. Para repetir um artefato anterior,
baixe o artefato daquele run, confira manifesto/hashes e use GITHUB_SHA igual
ao SHA do manifesto com o script de deploy, numa sessão autorizada. Não troque
o SHA para fazer passar um artefato diferente. Revise/fixe as actions por SHA
completo antes de aplicar em um ambiente sensível.
