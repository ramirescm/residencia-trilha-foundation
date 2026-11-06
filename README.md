# Residência, Trilha Foundation

Repositório evolutivo da Trilha Foundation da Residência DevOps na Nuvem. O
mesmo projeto acompanha o aluno durante as 12 sprints e recebe novas capacidades
sem descartar o que já foi construído.

## Estrutura do repositório

```text
residencia-trilha-foundation/
├── site/                              # SPA React e TypeScript
├── backend/
│   └── lambdas/
│       ├── 01-catalog-backend-api-lambda/
│       ├── 02-order-backend-api-lambda/
│       └── 03-order-processor-lambda/
└── infrastructure/
    ├── catch-up/                      # baselines cumulativos em CloudFormation
    │   ├── baselines/
    │   └── components/
    └── terraform/                     # IaC criada durante a trilha
        ├── bootstrap.sh
        ├── foundation/
        └── stacks/
```

Catch-up e Terraform possuem ciclos de vida diferentes. O catch-up entrega os
pré-requisitos para uma pessoa entrar na sprint atual. O diretório Terraform
recebe apenas as stacks que forem implementadas como parte dos desafios.

| Necessidade | Caminho | Ferramenta |
| --- | --- | --- |
| Entrar em uma sprint já iniciada | `infrastructure/catch-up` | CloudFormation |
| Executar os desafios atuais | `site` e `backend` | Console da AWS e código da aplicação |
| Construir IaC quando ela entrar na trilha | `infrastructure/terraform` | Terraform |

Não existem profiles Terraform por sprint. Os pontos de entrada ficam somente
nos baselines do catch-up.

## Catch-up para quem entra na Sprint 2

Quem começa diretamente na Sprint 2 pode preparar o resultado funcional da
Sprint 1 sem executar o laboratório anterior. O catch-up cria um bucket S3
privado e uma distribuição CloudFront por CloudFormation, gera o frontend em
modo mock e publica os arquivos. Ele usa a URL padrão do CloudFront, sem domínio
customizado.

```bash
AWS_PROFILE=seu-profile \
  ./infrastructure/catch-up/bootstrap.sh apply ready-for-sprint-02
```

Esse fluxo prepara o ambiente; ele não substitui o conteúdo ou as evidências da
Sprint 1. Consulte [infrastructure/catch-up/README.md](infrastructure/catch-up/README.md)
para acompanhar os eventos, verificar o ambiente ou removê-lo.

## Catch-up, tags e Terraform

Existem três conceitos independentes:

- a tag do Git determina a versão do código disponível naquele ponto da trilha;
- um baseline de catch-up prepara os pré-requisitos de quem entra em uma sprint;
- uma root stack Terraform representa infraestrutura construída pelo residente.

O início de cada sprint será marcado por uma tag. Assim, uma pessoa que entrar
diretamente na Sprint 6 poderá usar `start-sprint-06`. Essa versão já conterá o
resultado esperado até a Sprint 5, sem exigir a execução dos laboratórios
anteriores. Quem quiser executar a Sprint 5 poderá usar `start-sprint-05`, que
conterá o ponto anterior à implementação daquele desafio.

```text
start-sprint-05  -> ponto inicial para implementar a infraestrutura do frontend
start-sprint-06  -> frontend da Sprint 5 pronto; início do próximo desafio
```

A `main` representa o ponto mais recente já liberado. As tags preservam os
pontos anteriores sem duplicar diretórios ou manter uma branch por sprint.

### Quando Terraform entrar na trilha

Não existem profiles Terraform por sprint. Cada root stack aparece somente no
momento em que passa a fazer parte do conteúdo e evolui no mesmo diretório nas
sprints seguintes. O state continua independente por stack:

```text
residencia-foundation/01-web-edge.tfstate
residencia-foundation/02-identity.tfstate
residencia-foundation/03-marketplace-api.tfstate
```

Uma stack é executada explicitamente, sem associá-la a um baseline:

```bash
RESIDENCIA_STATE_BUCKET=meu-state-bucket \
  ./infrastructure/terraform/bootstrap.sh apply 01-web-edge
```

Ao chegar à sprint que introduz Terraform, remova primeiro o ambiente equivalente
criado pelo catch-up. CloudFormation e Terraform não devem administrar os mesmos
recursos simultaneamente. Consulte
[infrastructure/terraform/README.md](infrastructure/terraform/README.md) para a
convenção das root stacks e do state.

Fazer checkout de uma tag não altera a conta AWS. Antes de voltar para uma tag
anterior, remova o baseline ou as stacks atualmente provisionadas.

## Sprint 1: criar seu fork

No GitHub, abra o repositório original e selecione **Fork**. Depois clone o seu
fork, substituindo `SEU-USUARIO` pelo seu usuário do GitHub:

```bash
git clone https://github.com/SEU-USUARIO/residencia-trilha-foundation.git
cd residencia-trilha-foundation
git remote add upstream https://github.com/kenerry-serain/residencia-trilha-foundation.git
```

O remote `origin` aponta para o seu fork. O remote `upstream` aponta para o
repositório da Residência e será usado para receber as próximas sprints.

## Sprint 2 em diante: atualizar seu fork

Antes de começar uma nova sprint, entre no repositório local e traga a versão
mais recente da Residência:

```bash
cd residencia-trilha-foundation
git checkout main
git pull upstream main
git push origin main
```

O `pull` atualiza seu clone local com o conteúdo liberado no repositório
original. O `push` leva essa atualização para o seu fork no GitHub.

## Executar o site localmente

```bash
npm --prefix site install
npm --prefix site run dev
```

O endereço local padrão é `http://localhost:5173`.

## Autenticação

No desenvolvimento local, o site usa autenticação e dados mock:

```env
VITE_APP_MODE=mock
```

O formulário aceita qualquer e-mail válido e uma senha com pelo menos seis
caracteres. O modo local permite validar cadastro de produto, compra, estoque e
pedidos sem criar recursos na AWS. Nesse modo, sessão, produtos e pedidos ficam
no `localStorage` daquele navegador. Um selo visível identifica o ambiente como
`Mock mode · dados locais`.

Na Sprint 2, o frontend já está preparado para cadastro, confirmação de e-mail,
login, primeiro acesso, recuperação de senha e restauração da sessão pelo
Amazon Cognito. Informe:

```env
VITE_APP_MODE=production
VITE_AWS_REGION=us-east-1
VITE_COGNITO_USER_POOL_ID=us-east-1_xxxxxxxxx
VITE_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_API_URL=https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/prod
```

O arquivo [`site/.env.sprint-02.example`](site/.env.sprint-02.example) já contém
esse modelo. Copie-o para `site/.env.production.local`, preencha os valores dos
recursos criados no laboratório e gere um novo build.

Depois da autenticação, todas as chamadas ao API Gateway enviam o ID token
JWT no cabeçalho `Authorization: Bearer <token>`.

Com `VITE_APP_MODE=production`, o frontend não usa os dados locais. O selo muda
para `Production · AWS` e as operações passam a usar Cognito e API Gateway.

O carrinho permanece no navegador, separado por usuário, até a conclusão da
compra. Produtos, estoque e pedidos usam a API. Cada produto aceita até oito
imagens; o DynamoDB guarda a lista de chaves e os arquivos permanecem no S3.

## Backend da Sprint 2

O código das três Lambdas e a SPA do marketplace já estão prontos. O trabalho
do aluno é empacotar, publicar e conectar os recursos pelo Console da AWS.

| Lambda | Runtime | Responsabilidade |
| --- | --- | --- |
| `catalog-backend-api-lambda` | TypeScript (Node.js 24) | Consultar e cadastrar produtos no DynamoDB e gerar URLs temporárias para imagens no S3 |
| `order-backend-api-lambda` | .NET 8 | Consultar compras e vendas, gravar o pedido como `pending` e publicar o evento na SQS |
| `order-processor-lambda` | TypeScript (Node.js 24) | Consumir a SQS, baixar o estoque e confirmar o pedido numa transação do DynamoDB |

Na Sprint 2, as Lambdas usam `DATA_SOURCE=dynamodb`. A tabela substitui o mock
em memória e torna o fluxo consistente entre Lambdas e cold starts. Os adapters
para RDS continuam separados e poderão ser ativados depois com
`DATA_SOURCE=rds` e as variáveis de conexão, sem alterar os handlers.

Consulte [backend/README.md](backend/README.md) para conhecer os packages, os
handlers e as variáveis de ambiente.

## Build de produção do site

```bash
npm --prefix site run build
```

Os arquivos estáticos serão gerados em `site/dist` e poderão ser enviados para
o bucket S3 da Sprint 1.

## Sprint 4: pipelines e catch-up

Os workflows oficiais estão em `.github/workflows/frontend.yml` e
`.github/workflows/backend.yml`. As policies IAM e o guia estão em
[infrastructure/ci-cd](infrastructure/ci-cd/README.md). O plano está dividido em
configuração AWS/OIDC, pipeline do frontend e pipeline das três Lambdas.
Configure as roles e Repository Variables antes de executar os workflows.
Depois de publicados na main, eles executam nos pushes e por disparo manual.

Para entrar na Sprint 4 com o resultado até a Sprint 3, consulte o
[catch-up ready-for-sprint-04](infrastructure/catch-up/README.md).
O comando `plan` valida localmente; `apply` cria/atualiza recursos pagos e
precisa ser executado conscientemente na conta do laboratório.
