# Catch-up de infraestrutura

Este diretório prepara o resultado funcional de uma sprint anterior para quem
entra na Residência com a turma já em andamento. Ele não substitui o laboratório
nem marca a sprint anterior como concluída.

## Estrutura

```text
catch-up/
├── baselines/                       # pontos de entrada cumulativos
│   ├── ready-for-sprint-02.yaml     # seleciona o resultado da Sprint 1
│   ├── ready-for-sprint-03.yaml     # seleciona o resultado da Sprint 2
│   └── ready-for-sprint-04.yaml     # seleciona o resultado da Sprint 3
├── components/                      # capacidades reutilizáveis
│   ├── web-edge.yaml                # S3 e CloudFront
│   ├── marketplace-backend.yaml     # Cognito, API, Lambdas, DynamoDB e SQS
│   └── marketplace-backend-rds.yaml # VPC, endpoints, RDS e Proxy
└── bootstrap.sh                     # aplica os componentes do baseline
```

Um baseline representa o ambiente necessário para entrar em uma sprint. Quando
um baseline possui mais de um componente, o bootstrap aplica todos na ordem
correta e publica o frontend já configurado para o ambiente criado.

## Entrada na Sprint 4: resultado até a Sprint 3

`ready-for-sprint-04` usa os mesmos componentes e nomes de stack da Sprint 2.
O componente marketplace-backend passa a usar `marketplace-backend-rds.yaml`.
Preserva Cognito, API, DynamoDB, imagens e filas, e acrescenta:

- VPC, duas subnets privadas, route table e associações;
- Gateway endpoints S3/DynamoDB e Interface endpoints SQS/Secrets Manager com DNS privado;
- security groups encadeados Lambda → Proxy → RDS;
- PostgreSQL 16 privado, secret gerenciado, RDS Proxy com TLS;
- três Lambdas em VPC com DATA_SOURCE=rds e credencial obtida pelo Secrets Manager;
- inicializador SQL invocado explicitamente depois que o Proxy fica disponível.

Não há NAT, Internet Gateway ou banco público. RDS, Proxy e endpoints geram
custos contínuos. O laboratório usa instância single-AZ; não é um desenho de
alta disponibilidade de produção. Credencial administrativa é compartilhada
com as funções neste laboratório; em produção, separe usuários/permissões.

Valide localmente (SAM CLI atualizado; não executa deploy):

O SAM CLI precisa reconhecer o runtime `nodejs24.x`. Se a validação rejeitar
esse runtime, atualize o SAM CLI antes de continuar; não altere o runtime do
template para contornar uma instalação antiga. O empacotamento também exige
Node.js 24, .NET SDK 8 e `zip` instalados.

```bash
./infrastructure/catch-up/bootstrap.sh plan ready-for-sprint-04
```

Para aplicar **após revisão**, escolha uma versão PostgreSQL 16 disponível e
suportada por RDS Proxy na sua região, e confirme a conta:

```bash
aws rds describe-db-engine-versions --engine postgres --query 'DBEngineVersions[].EngineVersion'
AWS_PROFILE=seu-profile AWS_REGION=us-east-1 \
  CATCH_UP_EXPECTED_ACCOUNT_ID=SUA_CONTA \
  CATCH_UP_POSTGRES_VERSION=VERSAO_16_SUPORTADA \
  ./infrastructure/catch-up/bootstrap.sh apply ready-for-sprint-04
```

O script empacota Node 24/.NET 8 arm64, aplica as stacks, aguarda o Proxy,
executa o SQL idempotente, valida as tabelas, publica frontend configurado e
aguarda a invalidação. Falhas no schema interrompem antes da publicação.
Contas Cognito existentes são preservadas no upgrade; dados DynamoDB **não**
são migrados para SQL. O novo banco começa vazio. Teste o fluxo funcional de
catálogo, imagem, pedido e processamento após terminar.

Se os recursos foram criados manualmente, não rode catch-up sobre eles: o SAM
não assume sua propriedade. Os nomes das Lambdas são fixos; um segundo prefixo
não permite duplicar o ambiente na mesma conta/região. Use conta/região de
laboratório livre ou trabalhe no ambiente manual existente.

Não reaplique ready-for-sprint-03 sobre um ambiente RDS. O script bloqueia
esse downgrade. Reaplicar o baseline 04 pode substituir código de releases
publicadas posteriormente pela pipeline; revise seus ZIPs antes de aplicar.

### Remoção do ambiente RDS

Destroy automático é bloqueado para proteger dados. Revise no CloudFormation
os recursos das stacks exatas, faça backup e decida sobre retenção antes de
remover. A instância RDS tem DeletionPolicy/UpdateReplacePolicy Snapshot.
Snapshots, buckets com imagens/artefatos e outros recursos retidos podem
continuar gerando custos. Guarde os dados necessários para restaurar o banco;
não presuma que o secret gerenciado continuará acessível após excluir a instância.
Uma stack em ROLLBACK_COMPLETE não é mais removida automaticamente: inspecione
os eventos e os recursos antes de decidir se deve apagá-la.

## Entrada na Sprint 3

O baseline `ready-for-sprint-03` reaproveita o `web-edge` e acrescenta o
resultado funcional da Sprint 2: Cognito, API Gateway REST, três Lambdas,
DynamoDB, bucket de imagens, SQS e DLQ. O bootstrap empacota o backend, publica
os artefatos e gera o frontend em modo AWS com os outputs das stacks.

```bash
AWS_PROFILE=seu-profile \
  ./infrastructure/catch-up/bootstrap.sh apply ready-for-sprint-03
```

## Entrada na Sprint 2

O primeiro baseline cria somente a infraestrutura necessária para publicar o
frontend:

- bucket S3 privado;
- CloudFront com Origin Access Control;
- fallback de SPA para `index.html`;
- URL HTTPS padrão do CloudFront.

Não são criados domínio customizado, certificado ACM ou registros no Route 53.
O site é compilado com `VITE_APP_MODE=mock`, enviado ao bucket e tem o cache do
CloudFront invalidado automaticamente.

### Aplicar

Configure a AWS CLI e execute:

```bash
AWS_PROFILE=seu-profile \
  ./infrastructure/catch-up/bootstrap.sh apply ready-for-sprint-02
```

A criação da distribuição CloudFront normalmente leva alguns minutos. Ao final,
o script mostra a URL pública do frontend. Durante a espera, os eventos dos
recursos do CloudFormation aparecem no terminal; quando não há evento novo, um
sinal periódico mostra que a stack continua em andamento.

### Consultar

```bash
AWS_PROFILE=seu-profile \
  ./infrastructure/catch-up/bootstrap.sh status ready-for-sprint-02
```

### Remover

```bash
AWS_PROFILE=seu-profile \
  ./infrastructure/catch-up/bootstrap.sh destroy ready-for-sprint-02
```

O comando esvazia o bucket antes de remover a stack, porque o CloudFormation não
exclui buckets que ainda contenham objetos.
