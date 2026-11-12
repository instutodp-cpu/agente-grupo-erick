# Hermes Brain — atestação de duas fontes empresariais (2026-10-23)

## Escopo e evidência
- Destino canônico: Supabase `hermes-brain`, project `asceucchdnuoaqgdjbtg`, schema privado `hermes_brain`; tenant `grupo_erick`.
- Origem consultada diretamente: Supabase Softcom project `yxmdrrwqxwzsdgcgskrm`, view `hermes_history.monthly_commercial_2025_2026_v1` respaldada pela tabela `softcom_import.cadastro_de_vendas`.
- Metadados do PostgreSQL confirmaram a view e a tabela de origem. Consulta `SELECT` independente confirmou a view retornando 93 grupos de mês/loja, 90.638 registros, 1.869 cancelados, 88.769 não cancelados e R$ 11.455.850,76 em `valor_pago_noncancelled_sum` no escopo integral da view, cujo último dia de dado é 2026-06-08.
- Reconciliação do recorte janeiro/2025–maio/2026 diretamente contra a tabela bruta, com os mesmos predicados da view, deu **reconciled=true**: 89.304 registros, 1.811 cancelados, 87.493 não cancelados e R$ 11.290.498,65 de valor pago não cancelado. Estas são métricas **históricas importadas**, não caixa conciliado, vendas líquidas fiscais ou dívida exigível.
- O tenant e o membership já estavam ativos; domínios permitidos incluem `financeiro` e `comercial`, classificação `internal` e visibilidade `owner_only`. A concessão precede esta atestação; **nenhuma permissão de usuário foi modificada**.

## Admissão administrativa da fonte
Autorização do proprietário neste fluxo: cadastrar apenas fontes independentemente comprovadas, de forma idempotente e isolada por tenant. A fonte histórica, e não qualquer memória, foi admitida pelo canal SQL administrativo do projeto correto usando `INSERT ... SELECT` com predicados de tenant/membership ativos e `ON CONFLICT (tenant_id,provider,reference_digest) DO NOTHING`. Não se utilizou `service_role` para publicar memórias nem se simulou uma sessão `authenticated`.

- `tenant_id`: `grupo_erick`
- `provider`: `supabase_history`
- `source_id`: `5004243f-e8b2-4d2d-a888-25f39f753cc7`
- `reference_digest`: `sha256:f823e17a70ace2e6e95446366390786a9f7b1af052b6c230c136042ab61f8a6e`
- Digest calculado sobre UTF-8 de `grupo_erick:source:hermes_history.monthly_commercial_2025_2026_v1`, conforme o adapter de publicação da PR.
- `status`: `verified`; `source_updated_at`: `2026-06-08T00:00:00Z` (**último dia do dado**, não instante da atestação).
- Uma consulta **posterior e independente** à tabela de destino confirmou a linha, id, status e digest. Não interpretar a saída vazia do `SELECT` na mesma instrução CTE como falha de escrita.

## Limites e próximos gates
- **Não foi migrada, aprovada ou recuperada nenhuma das quatro memórias locais**. Na verificação, `memory_items=0`. Esta atestação da view não é evidência do conteúdo, da expiração, da versão nem da identidade de qualquer item armazenado na VPS.
- O dispositivo Remote Desktop Commander principal voltou online e permitiu inspecionar somente metadados e fatos empresariais autorizados de `owner-decisions.json`, `business-evidence-memory.json` e `auto-memory.json`; todos com permissão Unix `0600`. Havia 1 decisão humana confirmada e 3 agregados locais. Os IDs foram revalidados pelos algoritmos determinísticos do curador.
- A decisão específica `owner_confirmed_telegram:85852465a445`, confirmada em `2026-10-22T20:59:52.272Z`, foi relacionada ao registro original e ao texto curado exato. A fonte foi cadastrada **administrativamente e idempotentemente**, com provider `telegram_owner_confirmed`, source_id `2b627f7e-e890-4816-b69b-70e5a987cbf8` e reference_digest `sha256:f38b8f7cd71e4e99def9a04cc4b796aeb0d7838e3a1de94cf02af9bde433fc9a`. A política de source status é `verified` apenas para essa decisão comprovada.
- Os 3 agregados locais são `comercial`, originados da view Softcom validada. A reconciliação adicional por ano (jan–mai) confirmou 2025: 21.940 registros, 238 cancelados e R$ 2.730.133,04 pagos não cancelados; 2026: 24.148 registros, 623 cancelados e R$ 2.956.645,04 pagos não cancelados. Os textos das memórias locais coincidem.
- Dois registros do índice de evidências foram **atualizados em 2026-10-23 após a curadoria local**; seus `key` correspondem aos IDs das memórias de 2026-10-22 quando se considera o timestamp de origem da própria memória. Não substituir timestamps históricos de publicação pelos timestamps mais recentes sem nova curadoria verificável.
- Nenhum valor de credencial, ID de sessão, token, conteúdo bruto de chat ou dump integral foi copiado para o GitHub.
- `authenticated` tem somente `SELECT` sobre `memory_items` e não há política RLS de `INSERT`. Não contornar RLS por `postgres` ou `service_role` para gravar as memórias. Exigir sessão JWT vinculada e ingress confiável, política de escrita **restritiva e testada**, origem de cada item e recuperação RLS antes de ligar o adaptador ao Telegram.
- Nenhum merge, produção, acesso pessoal, conector novo ou cliente externo liberado por esta admissão.

## Consulta de auditoria não sensível
```sql
SELECT tenant_id,source_id,provider,reference_digest,status,source_updated_at
FROM hermes_brain.sources
WHERE tenant_id='grupo_erick' AND provider IN ('supabase_history','telegram_owner_confirmed');
```

## Candidatos determinísticos — sem publicação
A verificação local comprovou quatro candidatos válidos, `internal`, `owner_only`, todos não expirados na inspeção. Seus digests, calculados localmente como SHA-256 de `tenant_id:source_id:memory_local_id:source_version`, são:

| tipo | source_item_digest |
|---|---|
| decisão financeira | `sha256:af7f685362389986fde735a6892c89cc7ed74747fa9a7dd8d282db035d0d8571` |
| cancelamentos | `sha256:d5d3e682b9f21b333e8cec48a3ba13f8ef8e69b813fe6b4a634a4a5fca7297b3` |
| valor pago | `sha256:f366fd68e4436704028a3f825d62be7d7157391aa0f049785d686c633cdc04b5` |
| registros de venda | `sha256:909fd5bb34fd00784c9ae7f49ae012ade26111d9e9bc17cbdc8b7040875b05ee` |

Estes identificadores são uma conferência de preparação, **não prova de uma transação JWT/RLS**. A publicação real permanece bloqueada pela falta de uma sessão PostgreSQL `authenticated` confiavelmente vinculada ao `auth.uid()` e de privilégios limitados de admissão. **Não conceder INSERT amplo nem fazer INSERT como postgres em `memory_items`** para obter um falso sucesso.
