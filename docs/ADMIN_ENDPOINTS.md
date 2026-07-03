# Endpoints administrativos do Hermes

## Objetivo

Validar saúde, templates e rodar a validação dos SQL Templates **pelo
navegador/API**, com segurança, sem depender do Console Web do Railway (que pode
travar no mobile).

## Proteção

Todos os endpoints `/admin/*` são protegidos por um segredo enviado no header:

```
x-admin-secret: <ADMIN_SECRET>
```

Comportamento:

| Situação                              | Resposta |
| ------------------------------------- | -------- |
| `ADMIN_SECRET` não definido no ambiente | `503` — endpoints desabilitados |
| Header ausente ou segredo incorreto   | `401` — não autorizado |
| Segredo correto                       | `200` — conteúdo do endpoint |

A comparação do segredo é feita em tempo constante (`crypto.timingSafeEqual`).
O segredo **nunca** é registrado em log; falhas de autenticação logam apenas o
motivo (`missing_secret` / `invalid_secret`).

Defina o segredo no ambiente (Railway → Variables, ou `.env` local):

```
ADMIN_SECRET=um-segredo-longo-e-aleatorio
```

## Endpoints

### `GET /admin/health`

Saúde do serviço e presença de configuração (apenas booleanos — **nunca** os
valores dos segredos).

```json
{
  "status": "ok",
  "uptimeSeconds": 123,
  "templateCount": 6,
  "config": {
    "hasDatabaseUrl": true,
    "hasAnthropicKey": true,
    "claudeTimeoutMs": 120000,
    "chatResponseTimeoutMs": 180000,
    "maxToolLoops": 6
  },
  "timestamp": "2026-07-03T04:42:00.166Z"
}
```

### `GET /admin/templates`

Metadados dos SQL Templates. **Não inclui o SQL** (para não expor consultas
completas).

```json
{
  "count": 6,
  "templates": [
    { "name": "monthly_revenue_by_store", "version": "v1", "cacheProfile": "historical", "cacheTtlMs": 86400000, "description": "..." }
  ]
}
```

### `GET /admin/hil/metrics`

Métricas agregadas das decisões da HIL em shadow mode (contadores em memória).
**Nunca** expõe perguntas reais. Detalhes em `docs/HIL_ADMIN_METRICS.md`.

### `POST /admin/validate/templates`

Executa a validação real (somente leitura) de cada template contra o banco,
reutilizando a lógica de `src/hermes/template-validation.js` (a mesma do script
`scripts/validate-templates.js`). Retorna **apenas metadados** por template —
nunca linhas/valores do banco.

```json
{
  "total": 6,
  "okCount": 6,
  "errorCount": 0,
  "results": [
    { "template": "monthly_revenue_by_store", "status": "OK", "rowCount": 5, "durationMs": 142, "error": null }
  ]
}
```

Em caso de falha, `status` vira `"ERRO"` e `error` traz a mensagem **redigida**
(sem e-mail, CPF, CNPJ, telefone, chave Anthropic ou `DATABASE_URL`).

## Exemplos (curl)

```bash
BASE="https://SEU-APP.up.railway.app"
SECRET="um-segredo-longo-e-aleatorio"

curl -H "x-admin-secret: $SECRET" "$BASE/admin/health"
curl -H "x-admin-secret: $SECRET" "$BASE/admin/templates"
curl -X POST -H "x-admin-secret: $SECRET" "$BASE/admin/validate/templates"
```

## Garantias de segurança

- **Nunca expõe** `DATABASE_URL` nem `ANTHROPIC_API_KEY` (apenas presença, como
  booleano, em `/admin/health`).
- **Nunca expõe** o SQL completo dos templates.
- **Nunca expõe** o resultado real das queries — só `rowCount`, `durationMs`,
  `status` e erro redigido.
- Segredo enviado por header, comparado em tempo constante, e nunca logado.

## Logs estruturados

Correlacionados por `requestId`:

- `admin_auth_failed` — `requestId`, `route`, `reason`.
- `admin_health_check` — `requestId`.
- `admin_template_validation_start` — `requestId`.
- `admin_template_validation_finish` — `requestId`, `durationMs`, `total`, `okCount`, `errorCount`.
