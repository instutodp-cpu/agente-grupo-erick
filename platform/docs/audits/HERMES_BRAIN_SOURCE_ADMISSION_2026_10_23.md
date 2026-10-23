# Hermes Brain — atestação da primeira fonte empresarial (2026-10-23)

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
- Fonte `telegram_owner_confirmed` continua **não cadastrada**: é indispensável verificar os registros realmente confirmados, ids e timestamps na VPS. Não inferir confirmação de testes sintéticos ou de respostas de LLM.
- A VPS `srv1908789` estava offline nos dois devices Remote Desktop Commander. Sem acesso ao `auto-memory.json` protegido, não inventar snapshot nem transcrições.
- `authenticated` tem somente `SELECT` sobre `memory_items` e não há política RLS de `INSERT`. Não contornar RLS por `postgres` ou `service_role` para gravar as memórias. Exigir sessão JWT vinculada e ingress confiável, política de escrita **restritiva e testada**, origem de cada item e recuperação RLS antes de ligar o adaptador ao Telegram.
- Nenhum merge, produção, acesso pessoal, conector novo ou cliente externo liberado por esta admissão.

## Consulta de auditoria não sensível
```sql
SELECT tenant_id,source_id,provider,reference_digest,status,source_updated_at
FROM hermes_brain.sources
WHERE tenant_id='grupo_erick' AND provider='supabase_history';
```
