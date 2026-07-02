# CACHE.md

Documentação da PR-03: cache para SQL Templates e relatórios pesados.

## Objetivo

Reduzir custo, latência e carga no Supabase para perguntas recorrentes atendidas por SQL Templates, sem alterar o fallback atual para Claude.

## Escopo

Nesta PR o cache é aplicado somente para respostas de SQL Templates. Perguntas fora dos templates continuam seguindo para Claude e não entram no cache.

A implementação inicial usa uma estrutura em memória (`Map`) no processo Node.js. Isso é suficiente para validar comportamento e reduzir repetição dentro da mesma instância Railway. Em uma etapa futura, o cache pode migrar para Redis, Supabase ou outro armazenamento compartilhado.

## Arquivos

- `src/hermes/cache.js`:
  - cria `cache_key` estável;
  - lê entradas;
  - remove entradas expiradas;
  - grava respostas válidas.
- `src/hermes/sql-templates/index.js`:
  - define `version`, `cacheTtlMs` e `cacheProfile` por template.
- `server.js`:
  - consulta cache antes de executar query de template;
  - grava cache após query bem-sucedida;
  - registra logs de hit/miss/write/expired.

## Chave de cache

A chave é um SHA-256 estável calculado a partir de:

- `templateName`
- `templateVersion`
- `params`

O SQL completo, o texto completo da pergunta e resultados de banco não entram na chave.

## TTL por template

| Template | Perfil | TTL |
|---|---|---:|
| `monthly_revenue_by_store` | histórico | 24h |
| `recoverable_delinquency_by_store` | dado do dia | 10min |
| `revenue_year_comparison_by_store` | histórico | 7 dias |
| `top_products_last_six_months` | relatório pesado | 1h |
| `top_salespeople_by_year` | relatório pesado | 24h |
| `average_ticket_last_three_months` | dado do dia | 15min |

## Logs

### `cache_hit`

Emitido quando uma resposta válida é encontrada no cache.

Campos principais:

- `requestId`
- `intent`
- `templateName`
- `templateVersion`
- `cacheProfile`
- `cacheKey`
- `ageMs`
- `ttlMs`
- `rowCount`

### `cache_miss`

Emitido quando não há entrada para a chave.

### `cache_expired`

Emitido quando havia entrada, mas ela expirou e foi removida antes da nova query.

### `cache_write`

Emitido quando uma resposta de template bem-sucedida é gravada no cache.

Campos principais:

- `requestId`
- `intent`
- `templateName`
- `templateVersion`
- `cacheProfile`
- `cacheKey`
- `ttlMs`
- `rowCount`

## Regras de segurança

- Erros nunca são cacheados.
- Apenas respostas de SQL Templates são cacheadas.
- Perguntas livres e respostas do Claude não são cacheadas.
- SQL completo não é cacheado como metadado.
- Resultados brutos do banco não são cacheados separadamente; a entrada armazena a resposta final já formatada do template.
- Templates atuais não retornam dados sensíveis de cliente por padrão.

## Limitações atuais

- Cache é por instância Node.js; reinício do processo limpa tudo.
- Em múltiplas instâncias Railway, cada instância terá seu próprio cache.
- Não há invalidação manual nesta PR.
- Não há métricas agregadas de hit ratio nesta PR.

## Próximos passos

1. Adicionar testes automatizados para expiração e hit/miss.
2. Avaliar cache compartilhado quando houver múltiplas instâncias.
3. Adicionar dashboard de hit ratio, economia de queries e latência.
4. Definir invalidação manual para relatórios críticos.
