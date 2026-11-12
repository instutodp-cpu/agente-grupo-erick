# Hermes AutoMemory V1 — primeira fatia operacional

**Filosofia:** Evolução, não recriação. Maestro governa fontes/consentimento;
Hermes realiza curadoria e recuperação. Sem aprovação individual para
memórias de baixo risco provenientes de fontes previamente autorizadas.

## Entrega codificada
- Curador diário automático no MESMO poller privado do Telegram.
  Habilitação explícita em staging por `HERMES_AUTOMEMORY_ENABLED=true`;
  o padrão é **desligado**, sem ingestão silenciosa.
- Duas fontes estruturadas já governadas: decisões realmente confirmadas
  pelo proprietário; evidências históricas agregadas verificadas.
- Não lê texto bruto das mensagens, nem WhatsApp/Instagram pessoais,
  Gmail, ChatGPT/Claude, outras empresas ou listas não permitidas.
- `auto-memory.json` 0600 persistente no estado protegido do Telegram,
  idempotência de curação diária via `auto-memory-day.json`, limite de 32KB,
  hash de origem, expiração 14 dias (histórico) / 180 dias (decisão confirmada).
  Decisões confirmadas existentes não são revertidas nem alteradas.
- Comando owner-only `/memorias` para inspecionar o resultado, sem autoridade
  de escrita ou execução.
- Não há LLM de extração livre, scheduler externo, importação de conversas,
  integração persistente no Supabase nem autorização pessoal nesta etapa.
  Essas são as próximas partes da missão, e NÃO devem ser declaradas prontas.
- A migração 042 legada de revisão individual permanece NÃO aplicada; não
  instalá-la como percurso principal. Essa revisão deve ser reservada a
  exceções que exigem pessoa responsável.

## Gates de staging
CI verde e HEAD esperado; testar idempotência, expiração, tenant,
owner-only, PII e bloqueios por flag. Publicação requer update controlado
do container único com rollback, sem duplicar pollers, sem acesso pessoal,
com verificação de acesso `/memorias` pelo proprietário.

## Evidência E2E e qualidade de resposta
O proprietário recebeu o comando `/memorias` com quatro memórias reais;
a primeira versão repetia metadados do histórico e interrompia frases antes
dos números. O código da versão 2 compacta resultados verificados em linhas
completas de indicadores, com teste explícito de comparação e variação.
Os itens mantêm classificação e fonte originais; mensagens privadas e dados
de terceiros continuam fora do escopo.
A marca `policy_version=2` permitirá uma única recuração dos agregados
autorizados quando houver implantação controlada dessa versão.
**O código em PR não prova que a versão 2 já está publicada.**

## Dependência de permissão central
No banco `hermes-brain`, a associação empresarial inicial está restrita
ao domínio `projetos`. As quatro memórias operacionais são financeiras e
comerciais. A sincronização dessas memórias com a busca multi-tenant exige
concessão explícita de domínios correspondentes, RLS e teste autenticado.
Não aumentar as permissões automaticamente e não utilizar o acesso
privilegiado como atalho. A migração 042 de aprovação manual não deve
ser o fluxo principal do AutoMemory.

## AutoMemory no contexto do Hermes
- O `runTurn` do analista governado agora lê, por callback interno do
  poller já pareado, até duas memórias consolidadas relevantes ao objetivo.
- O contexto exige tenant `grupo_erick`, owner-only, fontes conhecidas,
  validade, tamanho limitado e rejeição de credenciais. Memória antiga não
  substitui leitura empresarial atual, decisão confirmada não autoriza ação.
- O cache de síntese é desativado quando contexto curado relevante participa
  do prompt, evitando respostas antigas com fingerprint que não representa a
  nova memória. Não há nova chamada de ferramenta nem LLM na curadoria diária.
- O código na PR precisa de CI e publicação separada para ser operacional.
  Não confundir testes simulados com uma resposta real recebida pelo Telegram.


## Supabase central publication admission / dry run (v1)

- The authenticated read model is already present: \`hermes_brain.tenants\`,
  \`memberships\`, \`sources\`, \`memory_items\` and \`public.hermes_brain_search\`.
  Do not recreate these tables or replace RLS with a service-role shortcut.
- \`hermes-brain-automemory-publication.js\` maps curated structured records
  to bounded, idempotent **uncommitted** candidate rows for existing
  \`memory_items\`, rejecting stale items, foreign tenants, missing Supabase
  principal, inactive membership, missing domains, absent source verification
  and visibility/classification mismatches. No real DB write or HTTP calls.
- Identities are NOT interchangeable: Telegram owner ID is NOT Supabase
  \`auth.uid()\`. A trusted authenticated session or gateway must provide
  that user claim, and RLS is independently authoritative at the DB boundary.
- Current Supabase membership only allows \`projetos\`, while the curated
  memories are \`financeiro\` / \`comercial\`. Additionally, \`sources\` and
  \`memory_items\` are empty and \`authenticated\` has SELECT-only privileges.
  All these are **real blockers**, not approval-per-memory requirements.
- Next operation: one-time authorized domain/source grant and authenticated
  identity binding; then implement transactional source-verification/admission
  with limited privileges and per-tenant RLS, idempotency and revoke tests.
- Automatic memory selection after source consent remains the product
  requirement; migration 042's manual-per-item-review path stays unapplied.
- The dry run MUST NOT be interpreted as successful central persistence.

## Transação autenticada de publicação (incremento staging)
- O port `publish` usa o contrato já existente `withAuthenticatedTransaction`: a conexão RLS deve estar autenticada pelo JWT Supabase, com `auth.uid()` conferido e `current_user=authenticated`.
- O mesmo BEGIN valida o membership ativo, todos os domínios permitidos e as fontes verificadas; revalida a fonte no INSERT idempotente e exige recibo ou rollback. Nenhum `SET ROLE`, service_role nem autenticação do Telegram por equivalência numérica.
- No estado real o `authenticated` tem apenas SELECT em memory_items, os domínios são apenas `projetos` e não há fontes verificadas: a publicação continua bloqueada, como exigido. NÃO conceder INSERT amplo por conveniência.
- O port só pode ficar operacional após uma concessão específica de fontes/domínios, autenticação do proprietário e política RLS de escrita com proteção tenant, owner, source, classificação e escopo. Não usar o estado de testes simulados para alegar sincronização concluída.
- Memória estruturada de fonte previamente aprovada pode ser curada sem aprovação individual; ações de negócio continuam bloqueadas.
