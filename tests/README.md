# Teste de carga com 10 usuários concorrentes (k6)

Guia para rodar cenários com **10 VUs simultâneos** (catálogo + pedidos), filtrar os logs por `correlationId` e checar problemas conhecidos.

> **Atenção ao limite da conta:** a quota de concorrência Lambda atual é **10**, compartilhada entre catálogo, pedidos e processadora. 10 VUs fazendo requisições em paralelo + a processadora consumindo a fila podem passar de 10 execuções e gerar throttle (500 do API Gateway). Para o primeiro teste, use 8 VUs ou peça aumento de quota (Service Quotas → Lambda → _Concurrent executions_).

---

## 1. Pré-requisitos

- k6 instalado (`brew install k6` ou `docker run --rm -i grafana/k6 run - < load.js`)
- App client do Cognito **sem client secret** e com `ALLOW_USER_PASSWORD_AUTH` habilitado
- Usuário de teste confirmado no pool
- Produto com **estoque alto** (senão aparece 409 em vez de gargalo real)
- Tracing ativo (X-Ray) e `AWSXRayDaemonWriteAccess` nas três roles

Nunca grave senha no arquivo: use variáveis `-e`.

---

## 2. Script `load-10-vus.js`

# Diferença entre o teste do README (rampa) e o teste novo (10 VUs)

A diferença principal é o modelo de carga é que um controla a **taxa de requisições**, e o outro controla o **número de usuários simultâneos**.

|                         | Teste (ramp)                                            | Teste (10 VUs)                                                                                                      |
| ----------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Executor                | `ramping-arrival-rate`                                  | `constant-vus`                                                                                                      |
| O que fixa              | Requisições por segundo                                 | Usuários simultâneos (10)                                                                                           |
| Carga                   | Sobe de 1 até 100 req/s (catálogo) e 10 req/s (pedidos) | Constante, cerca de 15 a 20 req/s no total (estimativa: ~0,5 s por ciclo, contando a latência e o `sleep` de 0,2 s) |
| Duração                 | 60 s, 4 degraus de 15 s                                 | 2 min por padrão (`DURATION`)                                                                                       |
| VUs                     | Dinâmicos, 10 a 100 por cenário                         | Fixos, no máximo 10 em paralelo                                                                                     |
| Pausa entre requisições | Nenhuma                                                 | `sleep` de 0,2 s (`THINK_TIME`)                                                                                     |
| Configuração            | Valores no código                                       | Variáveis `-e` (`CATALOG_VUS`, `ORDER_VUS`, `DURATION`)                                                             |
| Objetivo                | Achar o ponto de ruptura                                | Medir o comportamento com concorrência fixa e repetível                                                             |

## Por que o resultado muda

- **Rampa:** se a API fica lenta, o k6 continua enviando na mesma taxa e abre mais VUs. Foi o que gerou a avalanche de 500 a partir de ~32 s.
- **10 VUs:** cada VU espera a resposta antes de mandar a próxima. Se a API fica lenta, chegam menos requisições. O teste se autolimita e tende a esconder o colapso.

## Quando usar cada um

- **Rampa:** para descobrir onde a arquitetura quebra, como no desafio.
- **10 VUs:** para ter uma linha de base estável e comparar antes e depois de uma mudança, como o aumento de quota.
- **Contra a quota de 10:** o teste de 10 VUs não deve gerar a mesma avalanche. As 10 requisições em voo mais a processadora podem ainda encostar no limite e gerar throttle pontual, mas é bem menos agressivo que a rampa.

## Comparar com a mesma carga

Se quiser comparar os dois com a mesma carga, `constant-arrival-rate` fixa a taxa (por exemplo, 20 req/s) sem rampa e mantém a pressão mesmo quando a API desacelera.

---

## 3. Como rodar

### Cenário A: 10 VUs (8 catálogo + 2 pedidos), 2 minutos

```bash
k6 run \
  -e API=https://api.seudominio.com \
  -e CLIENT_ID=<app-client-id> \
  -e USERNAME=<usuario-de-teste> -e PASSWORD=<senha> \
  -e PRODUCT_ID=<id-com-estoque-alto> \
  load-10-vus.js
```

### Cenário B: só catálogo (10 VUs)

```bash
k6 run -e CATALOG_VUS=10 -e ORDER_VUS=0 ... load-10-vus.js
```

### Cenário C: só pedidos (10 VUs), para testar a fila e a processadora

```bash
k6 run -e CATALOG_VUS=0 -e ORDER_VUS=10 ... load-10-vus.js
```

### Cenário D: dentro do limite da conta (8 VUs)

```bash
k6 run -e CATALOG_VUS=6 -e ORDER_VUS=2 ... load-10-vus.js
```

### Cenário E: smoke test (30 s)

```bash
k6 run -e DURATION=30s ... load-10-vus.js
```

### Salvar o resultado

```bash
k6 run --summary-export=resultado.json ... load-10-vus.js
```

> `CATALOG_VUS=0` ou `ORDER_VUS=0` não é aceito por alguns k6 antigos. Se der erro, remova o cenário do `options`.

### Como ler o resumo do k6

| Métrica                                 | O que observar                                            |
| --------------------------------------- | --------------------------------------------------------- |
| `http_req_failed{endpoint:...}`         | % de falhas por endpoint                                  |
| `http_req_duration{endpoint:...}` p(95) | Latência dos que deram certo                              |
| `checks`                                | % de respostas com o status esperado                      |
| `dropped_iterations`                    | k6 não conseguiu manter a carga (só em executors de taxa) |
| `vus_max`                               | Máximo de VUs usados                                      |

Cada erro impresso mostra `status`, `cid` (x-correlation-id) e o corpo.

---

## 4. Como identificar a origem do erro pelo corpo

| Corpo da resposta                                                     | Origem                                                                        |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `{"message":"Internal server error."}` (com ponto) e `cid` preenchido | `catch` da Lambda. Buscar o `correlationId` nos logs                          |
| `{"message": "Internal server error"}` (sem ponto) e `cid=undefined`  | API Gateway: a Lambda não respondeu (throttle, timeout, crash, falha de init) |
| 502 / `Service Unavailable`                                           | Resposta malformada, timeout ou throttle                                      |
| 401                                                                   | Authorizer rejeitou o token (client errado, token expirado, tipo de token)    |
| 409                                                                   | Estoque insuficiente (não é gargalo, é dado)                                  |
| 429                                                                   | Throttling do API Gateway                                                     |

---

## 5. Filtrar nos logs (CloudWatch Logs Insights)

Selecione os log groups: `/aws/lambda/catalog-backend-api-lambda`, `/aws/lambda/order-backend-api-lambda` e `/aws/lambda/order-processor-lambda`. Ajuste o intervalo para cobrir o teste.

### 5.1 Uma requisição específica (ponta a ponta)

```
fields @timestamp,
       replace(@log, "<account-id>:/aws/lambda/", "") as sistema,
       correlationId, message, level, @xrayTraceId
| filter correlationId = "<id>"
   or @message like "<id>"
| sort @timestamp asc
```

### 5.2 Resumo por correlationId e sistema

```
fields correlationId, message, level
| filter ispresent(correlationId)
| parse @log "*:/aws/lambda/*" as conta, sistema
| stats count(*) as eventos,
        min(@timestamp) as inicio,
        max(@timestamp) as fim,
        earliest(message) as primeira_etapa,
        latest(message) as ultima_etapa,
        sum(level = "error") as erros
  by correlationId, sistema
| sort inicio desc
| limit 100
```

### 5.3 Compras que não concluíram

```
fields correlationId, message, level
| filter ispresent(correlationId) and message like /^order-/
| stats min(@timestamp) as inicio,
        sum(message = "order-request-received") as recebido,
        sum(message = "order-enqueued") as enfileirado,
        sum(message = "order-processed") as processado,
        sum(level = "error") as erros
  by correlationId
| filter enfileirado > 0 and processado = 0
| sort inicio desc
```

Compra saudável: `recebido=1`, `enfileirado=1`, `processado=1`, `erros=0`.

### 5.4 Retries da processadora

```
fields correlationId, receiveCount
| filter message = "order-processing-started"
| stats max(receiveCount) as tentativas by correlationId
| filter tentativas > 1
| sort tentativas desc
```

### 5.5 Processadora ao longo do tempo

```
fields correlationId, receiveCount
| filter message = "order-processing-started"
| stats count(*) as invocacoes, max(receiveCount) as max_tentativas by bin(1m)
| sort bin(1m) asc
```

### 5.6 Erros que não passaram pelo `catch` (timeout, crash, throttle)

```
fields @timestamp, @log, @message
| filter @message like /Task timed out|Runtime\.|Throttl|ECONN|ENOTFOUND/
   or (@message like /REPORT/ and (@message like /Status: error/ or @message like /Status: timeout/))
| sort @timestamp desc
| limit 50
```

### 5.7 Permissões negadas

```
fields @timestamp, @log, @message
| filter @message like /AccessDenied|not authorized to perform/
| sort @timestamp desc
| limit 20
```

### 5.8 Cold starts

```
fields @timestamp, @log, @initDuration, @duration
| filter ispresent(@initDuration)
| stats count(*) as cold_starts, max(@initDuration) as init_max by bin(1m), @log
| sort bin(1m)
```

### 5.9 Requisições por método (catálogo e pedidos)

```
fields message, coalesce(method, data.method) as metodo, coalesce(path, data.path) as caminho
| filter ispresent(metodo)
| parse @log "*:/aws/lambda/*" as conta, sistema
| stats count(*) as requisicoes by sistema, metodo, caminho
| sort sistema, metodo
```

---

## 6. Métricas no CloudWatch durante o teste

| Camada   | Métricas                                                                                     | Sinal de problema                                                    |
| -------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| REST API | `Latency`, `IntegrationLatency`, `4XXError`, `5XXError`, `Count`                             | 5XX sem log na Lambda; `Latency` muito acima de `IntegrationLatency` |
| Lambdas  | `ConcurrentExecutions`, `Throttles`, `Errors`, `Duration` (p95/max), `InitDuration`          | `Throttles > 0`; `ConcurrentExecutions` encostando em 10             |
| SQS      | `ApproximateAgeOfOldestMessage`, `ApproximateNumberOfMessagesVisible`, DLQ                   | Idade da mensagem crescendo; mensagens na DLQ                        |
| DynamoDB | `ThrottledRequests`, `ConsumedReadCapacityUnits`, `SuccessfulRequestLatency`, `SystemErrors` | Leitura alta no `GET /products` (efeito do `Scan`)                   |

Limite da conta:

```bash
aws lambda get-account-settings --region us-east-1
```

Ver `AccountLimit.ConcurrentExecutions`.

---

## 7. Checklist de problemas

### Antes do teste

- [ ] Login do Cognito funciona (`setup()` não aborta)
- [ ] `GET /products` e `POST /orders` retornam 200/202 com 1 requisição manual
- [ ] Produto com estoque suficiente para o teste inteiro
- [ ] Active tracing ligado nas três Lambdas
- [ ] Roles com `AWSXRayDaemonWriteAccess` e permissões de DynamoDB/SQS/S3 corretas
- [ ] Timeout de cada Lambda adequado (3 s é curto para cold start; processadora menor que o visibility timeout / 6)
- [ ] Memória das Lambdas (128 MB deixa o init lento, principalmente .NET)
- [ ] Limite de concorrência da conta conhecido

### Durante o teste

- [ ] `ConcurrentExecutions` por função e da conta
- [ ] `Throttles` das três Lambdas
- [ ] `5XXError` e `Latency` do API Gateway
- [ ] `ApproximateAgeOfOldestMessage` da fila
- [ ] Mensagens na DLQ

### Depois do teste

- [ ] Erros 500 sem `x-correlation-id` → throttle, timeout ou falha de init (query 5.6)
- [ ] Erros 500 com `x-correlation-id` → exceção tratada (query 5.1 com o ID)
- [ ] 401 → client, tipo de token (ID vs access) ou expiração
- [ ] Compras com `enfileirado > 0` e `processado = 0` (query 5.3)
- [ ] `tentativas > 1` na processadora (query 5.4): timeout, permissão ou erro intermitente
- [ ] `AccessDenied` nos logs (query 5.7)
- [ ] Picos de `InitDuration` (query 5.8)
- [ ] Latência do `GET /products` crescendo com o tamanho da tabela (efeito do `Scan`)
- [ ] 409 por estoque esgotado
- [ ] Trace map: API Gateway → pedidos → SQS → processadora, com DynamoDB como nó de saída
- [ ] Limpar pedidos de teste da tabela

### Problemas conhecidos neste projeto

| Sintoma                                                        | Causa provável                                       | Ação                                                    |
| -------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| 500 sem ponto final e `cid=undefined` a partir de ~20-35 req/s | Quota de concorrência da conta (10)                  | Pedir aumento de quota; reserved concurrency depois     |
| Pedido com `receiveCount` 2 ou 3 sem `order-processing-failed` | Timeout da processadora ou propagação de IAM         | Revisar timeout e visibility timeout; reexecutar        |
| `order-request-received` ausente                               | Deploy antigo do `Function.cs`                       | Publicar versão com o log inicial                       |
| `AccessDenied` em `dynamodb:GetItem`                           | Role da processadora sem permissão na tabela         | Ajustar inline policy                                   |
| `@xrayTraceId` vazio                                           | Requisição não amostrada ou role sem permissão X-Ray | Gerar mais tráfego; conferir `AWSXRayDaemonWriteAccess` |
| `GET /products` lento com tabela grande                        | `Scan` com filtro                                    | GSI por `entityType` e `Query`                          |
| `ListOrders` lento                                             | `Scan` com filtro                                    | GSIs por `buyerId` e `sellerId`                         |
| Header `x-correlation-id` ilegível no navegador                | Falta `access-control-expose-headers`                | Expor o header no `Json()`                              |

---

## 8. Registro do resultado

Para cada execução, anote:

| Campo                                           | Valor |
| ----------------------------------------------- | ----- |
| Data/hora                                       |       |
| VUs (catálogo / pedidos)                        |       |
| Duração                                         |       |
| Total de requisições                            |       |
| % de falha (catálogo / pedidos)                 |       |
| p95 (catálogo / pedidos)                        |       |
| Primeiro erro apareceu em (s) e com quantos VUs |       |
| `Throttles` / `ConcurrentExecutions` máx.       |       |
| Idade máxima da mensagem na fila                |       |
| Camada que mudou primeiro                       |       |
| Ação tomada                                     |       |
