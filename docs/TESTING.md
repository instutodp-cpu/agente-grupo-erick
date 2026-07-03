# TESTING.md — Testes automatizados mínimos

## Objetivo

Garantir que as três peças críticas do fluxo — **SQL Templates**, **cache** e
**guardrails de SQL livre** — não quebrem silenciosamente nas próximas
mudanças. São testes de unidade rápidos, sem rede.

## Como rodar

```bash
npm test
```

Isso executa `node --test`, o test runner nativo do Node (>= 18). **Não há
dependências novas** — não usamos Jest, Mocha ou similares.

## Estrutura

Os testes ficam em `test/`, um arquivo por módulo:

| Arquivo                        | Cobre                                            |
| ------------------------------ | ------------------------------------------------ |
| `test/sql-templates.test.js`   | Classificador de intenção e perguntas da tela.   |
| `test/cache.test.js`           | Chave estável, hit, miss, expired, não-cachear.  |
| `test/sql-guardrails.test.js`  | Validação do SQL livre (allowlist, bloqueios).   |

## O que é testado

### SQL Templates (`test/sql-templates.test.js`)

- `classifyIntent` casa perguntas claras e retorna `null` para perguntas
  ambíguas (ex.: faturamento sem mês/ano) ou fora do escopo — que seguem para o
  fallback Claude.
- **Perguntas frequentes da tela**: cada chip de `public/index.html` é testado
  contra o intent esperado, funcionando como teste de regressão do frontend
  para o classificador (sem depender do frontend em si).
- `buildTemplateExecution` devolve execução completa (`sql`, `values`,
  `format`, versão) para uma pergunta válida e `null` para uma inválida.

### Cache (`test/cache.test.js`)

- **Chave estável**: `createCacheKey` independe da ordem dos parâmetros e muda
  quando nome/versão/params mudam.
- **hit / miss / expired**: gravação e leitura dentro do TTL (hit), chave
  inexistente (miss), e leitura após o TTL (expired) com remoção da entrada.
  A expiração é testada de forma determinística injetando `now`, sem depender
  do relógio real.
- **Não cachear erro**: o servidor só grava no cache no caminho de sucesso. No
  nível do módulo, validamos o contrato equivalente — sem `setCacheEntry` a
  chave permanece `miss`, e um TTL não-positivo não grava nada.

### Guardrails (`test/sql-guardrails.test.js`)

- Permitidos: `SELECT` simples, `SELECT` qualificado por schema, CTE (`WITH`) e
  subqueries em `FROM`/`IN`/`JOIN`.
- Bloqueados: `INSERT`/`UPDATE`/`DELETE`, `DROP`/`ALTER`/`TRUNCATE`,
  `CREATE`/`GRANT`/`REVOKE`, múltiplas statements, comentários (`--`, `/* */`)
  e schemas/tabelas fora da allowlist.
- `LIMIT` padrão aplicado quando ausente e preservado quando presente.
- Bloqueio retorna mensagem amigável.

## Garantias de ambiente

- **Sem Supabase real**: nenhum teste abre conexão com banco. Os guardrails e o
  cache são funções puras; o classificador de templates apenas monta SQL/params
  (não executa).
- **Sem chaves reais**: nenhum teste lê `ANTHROPIC_API_KEY` nem `DATABASE_URL`.
  Verificado rodando `npm test` com essas variáveis ausentes.
- **Sem regra de negócio nem frontend alterados**: esta suíte só adiciona
  arquivos em `test/` e o script `test` no `package.json`.

## Próximos passos sugeridos

- Testar a formatação em markdown de cada template (`format`).
- Testes de integração do endpoint `/api/chat` com um cliente HTTP mockando o
  Claude e o Postgres (fora do escopo desta suíte mínima).
