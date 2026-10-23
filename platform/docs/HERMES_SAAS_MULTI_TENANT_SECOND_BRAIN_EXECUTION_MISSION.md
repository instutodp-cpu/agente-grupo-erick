# Hermes / Maestro OS — Missão GOAL MODE: Segundo Cérebro Multi-tenant SaaS

Estado: diagnóstico baseado em contratos oficiais e runtime V19 de staging,
2026-10-22. **Não é prova de SaaS em produção nem autorização para ingestão de
dados pessoais ou de clientes terceiros.** Evolução, não recriação.

## Norte de produto e arquitetura existente

1. Maestro = control plane de identidades, espaços, assinaturas, autorização,
   aprovação humana, budgets, políticas, governança e auditoria.
2. Hermes = execution plane multi-domínio por capacidades/ports/adapters,
   modelos selecionados por necessidade, chamadas governadas, rastreabilidade
   e execução limitada ao escopo autorizado.
3. Domínio é uma capacidade instalável/configurável por tenant (Compras, RH,
   Vendas, Estoque, Marketing, Jurídico, Pessoal, Desenvolvimento, Pesquisa,
   Atendimento etc.), **não um Hermes ou agente completo duplicado por domínio**.
4. Uma instância de serviço pode atender vários tenants no futuro, mas cada
   tenant tem identidade, RLS, segredos, índices, cache, quotas, conectores,
   memória, proveniência, retenção, auditoria e custeio próprios.
5. O piloto Grupo Erick é um tenant; o espaço pessoal do usuário é outro.
   Os futuros clientes pagantes usam tenants separados, inclusive clientes
   que possuem várias empresas/lojas/departamentos e usuários.
6. Os conectores são portas para fatos atualizados; o LLM NÃO é a fonte de
   verdade, a memória importada NÃO é autoridade e uma recomendação NÃO é
   autorização para executar.

## Auditoria de contratos: preservar, não substituir

| Contrato/implementação já existente | Retenção / limitação verificada |
|---|---|
| HERMES_AI_PLATFORM_V2_BLUEPRINT.md | Ports/adapters, registries, policy gateway e separação de modelo permanecem. O texto antigo Railway/Qdrant/Redis descreve alvo histórico, não prova do deploy atual na Hostinger; Codex Login já é usado no staging. |
| TENANT_WORKSPACE_ISOLATION.md | Taxonomia oficial: pessoal personal::<user_id>, empresa-piloto grupo_erick, SaaS client::<client_id>. Documento declarativo, não é isolamento real. |
| PERSONAL/CORPORATE/EXTERNAL_CLIENT_WORKSPACE_CONNECTOR_POLICY.md | Contratos candidatos, não OAuth/credenciais e integrações comerciais prontas. Atenção: CORPORATE usa workspace_type=corporate, enquanto TENANT_WORKSPACE_ISOLATION usa grupo_erick. Canonizar na borda autenticada sem migração implícita de dados. |
| HERMES_AGENT_MEMORY_CONTRACTS.md / HERMES_CONTEXT_ASSEMBLY_ENGINE.md / SECOND_BRAIN_INBOX_CONTRACT.md | Referências e planos declarativos não armazenam, buscam ou montam conteúdo real. Não confundir com segundo cérebro entregue. |
| Memória operacional Telegram V19 | Histórico Softcom por view agregada, evidências empresariais e decisão owner-only funcionam em estágio single-tenant. NÃO são runtime multi-tenant nem podem ser expostos a clientes externos sem autenticação e RLS. |
| Base44 Maestro Pessoal / Hermes Insight Hub / Compras homologação | Reutilizar apps e entidades existentes; cadastro visível não demonstra sincronização, permissões reais entre sistemas, cobrança nem estabilidade comercial. |
| Supabase Softcom | Fonte empresarial histórica; não é a instância compartilhada do segundo cérebro multiempresa. A integração segura ao Linx está pendente de autorização contratual. |
| PR #564 | Segue Draft, base de trabalho hermes/a3-official-simulation-origin; não presumir que passou à main ou foi liberada produção. |

## Hierarquia oficial de escopos

- **Tenant**: menor limite rígido de isolamento, faturamento, quota,
  criptografia e recuperação. `grupo_erick`, `personal::<id>`,
  `client::<id>`; não obter tenant da mensagem nem confiar em um
  tenant_id enviado por connector/LLM.
- **Organização/empresa (company)**: propriedade e escrituração de
  várias empresas sob tenant; pode haver mais de uma pessoa jurídica.
- **Unidade/loja, departamento e marca**: filtros ABAC explícitos
  combinados com RBAC, sem concessão implícita por papel "admin"
  de outra empresa.
- **Usuário**: pode participar de múltiplos tenants com memberships
  independentes; escolha explícita e autenticada do espaço ativo;
  dono pessoal não herda acesso corporativo e vice-versa.
- **Domínio**: `allowed_domains` e `denied_domains` resolvidos
  pelo control plane, em intersecção com escopo da fonte e da ação.
- **Dado**: metadados obrigatórios: tenant, owner, company/store quando
  aplicável, fonte/source-id, timestamp efetivo, revisão, sensibilidade,
  consentimento/base legal quando necessário, retenção, expiração, versão,
  estado de aprovação. Conteúdo bruto nunca é autoridade executiva.

Para clientes enterprise com exigência regulatória, permitir provisionamento
de banco/projeto isolado por tenant como política de implantação. Não impor um
novo banco por app/domínio. Padrão candidato: tabelas compartilhadas com
PostgreSQL RLS por tenant + testes IDOR, com separação física quando
contratada. Nunca confiar só em `WHERE tenant_id` feito pela IA.

## Fluxo de segundo cérebro, ponta a ponta

1. Identidade autenticada + membership ativo + tenant verificado; ingress
   normaliza canal, ação, escopo, aprovação e limites sem usar prompt.
2. Catálogo de fontes por tenant: ERP, Base44, Supabase histórico, e-mail,
   Drive, conversas ChatGPT/Claude exportadas, WhatsApp consentido, Instagram
   Business autorizado, documentos, notas e eventos. Fonte conectada não
   concede acesso automaticamente. Conector mantém conta, owner e scopes.
3. Ingestão incremental e consentida: eventos/documentos selecionados,
   fingerprint/source-version, deduplicação, versões, classificação de
   sensibilidade, PII redigida, origem e consentimento comprováveis.
   A sincronização periódica só para provedores e escopos homologados.
4. Memória: fatos **propostos** -> revisados/aprovados quando necessário,
   decisões humanas confirmadas separadas de transcrições, proveniência,
   validade/expiração, revogação, arquivamento e eliminação. Nada é gravado
   automaticamente como verdade permanente.
5. Recuperação: authorization gate ANTES da consulta, filtro RLS/tenant,
   permissões empresa/loja/domínio, score/relevância, versão, dedup, top-k
   limitado; contexto mínimo com citações. Busca textual primeiro;
   vetorial/pgvector opcional atrás do mesmo port se métricas justificarem.
6. Planejamento: consulta determinística e cache verificado -> síntese com
   modelo homologado -> ferramentas governadas apenas quando necessárias;
   limites e consentimento aplicados novamente antes da ação.
7. Resultado: fontes, data de atualização, restrições, decisão humana,
   nenhuma resposta inventada; auditoria de metadados sem conteúdos
   sensíveis. Ações enviadas/publicadas/escritas continuam sob aprovação.
8. Ciclo de vida: detecção de mudança na origem, invalidar cache/índice,
   prazo de retenção, exclusão/portabilidade LGPD, backup e restore por
   tenant com prova de não vazamento.

## Portas existentes e próximos incrementos coesos

**Missão 1 — identidade + memória empresarial/pessoal real**

- Resolver sessão autenticada para tenant/membership (sem escolher via
  linguagem natural). O novo `hermes-brain-tenant-boundary.js` é guard
  puro de **leitura**: rejeita tenant cruzado, usuário diferente, domínio,
  classificação, loja, empresa, fato pendente/expirado. Seus testes não
  habilitam storage, não autenticam ninguém nem liberam tenants.
- Usar o banco Supabase do Hermes já contratado **depois de verificar
  projeto/organização corretos**. Só então introduzir migrações versionadas
  com RLS, chaves compostas por tenant, registro da fonte, facts, decisões,
  document references, membership, audit e tombstones. Não acoplar ao
  banco Softcom e não usar service_role como bypass de leitura.
- Migrar decision memory atual com export controlado, sem duplicar
  confirmação, sem mudar a autoridade humana.
- Disponibilizar `lembrar`, `buscar`, `fontes`, `pendências` no
  Telegram owner-only para o tenant Grupo Erick, e um espaço pessoal
  autenticado separado. Critério: dado aprovado persistente sobrevive a
  reinício, retorna referência e não cruza tenant em testes adversariais.

**Missão 2 — 3 fontes com resultados úteis**

- Piloto com histórico Softcom + decisão confirmada + Compras homologação
  **via API/read-only já autorizada e tenant scope validado**. Não copiar
  dados empresariais para outro app sem consentimento/configuração.
- Upload/import seletivo de ChatGPT/Claude para memória **privada** após
  revisão; conversas externas não viram decisão automaticamente.
- Gmail/Drive/Agenda somente após OAuth/scope/consentimento por workspace.
  Ter integrações Base44 listadas NÃO significa conectores autorizados.

**Missão 3 — canais e operações**

- Mesmo Hermes por Telegram, WhatsApp Business (provedor homologado),
  apps e outros canais; identidade verificada e escopo do canal.
- Mensagens pessoais de WhatsApp: importação voluntária de conversas
  selecionadas, respeito a dados de terceiros; nunca alegar API irrestrita.
- Suporte comercial: aprovar tarefa/rastro; humanos executam merge e ações
  irreversíveis conforme políticas; modelos não recebem credenciais.

**Missão 4 — SaaS vendável, antes de primeiro cliente real**

- Autocadastro/convite de empresas, verificação de domínio/organização,
  criação de tenant, memberships, revogação, suspensão, onboarding seguro,
  catálogos de domínios/planos/limites, trials, upgrade/downgrade.
- Metering **por tenant, canal, ferramenta e modelo**, cotas e orçamento;
  débito idempotente, reconciliado com provedor; separar estimativa de
  cobrança real, estorno e despesas de infra.
- Contratos, base legal/consentimento, LGPD, suboperadores, DSAR,
  exportação, deleção, criptografia/segredos, incidentes, restore e
  auditoria de acesso por empresa.
- Testes de cliente A/B, domínio, loja, cache, vector search, jobs,
  webhook, export, logs, backup/restore; nenhum tenant vê dados de outro.
  Observabilidade e custo dimensionados por tenant; limites de abuso.
- Planos comerciais/SLAs e isolamento físico opcional para enterprise.
  Nenhum cliente externo é ativado só porque o Telegram Grupo Erick passou.

## Readiness em 2026-10-22 (sem inflar status)

| Capacidade | Contrato | Real staging | Comercial |
|---|---|---|---|
| Orquestração, canário, autorização humana | sim | pilotos limitados | não homologado |
| Telegram proprietário + histórico/decisões | sim | sim | não multi-tenant |
| Domain registry, policy, memory contracts | sim | parcial/simulação | não homologado |
| Memória persistente multi-tenant + RLS | previsto | NÃO comprovado | bloqueado |
| Ingestão de ChatGPT/Claude/WhatsApp/Instagram | previsto | NÃO comprovado | bloqueado |
| IAM multi-organização e ABAC | previsto | guard de leitura isolado testado | bloqueado |
| Autocadastro/billing SaaS/quotas por tenant | previsto | NÃO comprovado | bloqueado |
| Linx atual | planejado | conectividade de rede apenas | bloqueado |

**GOAL MODE:** concentrar implementação da missão 1 na PR de trabalho
existente enquanto coerente com seu escopo. Evitar versões de 1 comando.
Sem segredos em código, sem merge pela IA, sem produção, sem ativação
de cliente externo sem aprovação humana e sem critérios demonstrados.

## Primeiro incremento de persistência — esquema testado, NÃO implantado

A PR inclui `038_create_second_brain_multi_tenant_read_model.sql`,
modelo relacional com **tenants**, **memberships**, **sources** e
**memory_items**, chaves que incluem `tenant_id`, source digest/version,
classificação, domínio, empresa/loja, owner, origem aprovada, validade e
índice GIN full-text. A política RLS exige `auth.uid()` + membership
ativa, tenant ativo, fonte verificada, item aprovado/não expirado,
domínio/classificação/visibilidade autorizados, company/store exatos.
`FORCE ROW LEVEL SECURITY` em todas as quatro tabelas. A função
`auth.uid()` é a original do Supabase no futuro banco canônico;
a simulação local utiliza um **stub que nunca será implantado**.

O papel `authenticated` recebe somente `SELECT`: não há privilégios
de INSERT/UPDATE/DELETE, não há políticas para `anon`, não há função
`SECURITY DEFINER` nem views que possam contornar RLS. A ingestão e
curadoria deverão ter processo administrativo **separado**, com prova
de tenant/source/idempotência e aprovação humana antes de conceder
qualquer capacidade de escrita. Memória não concede execução real.

A porta `hermes-brain-postgres-search.js` faz busca textual limitada
(1–10 itens), parametrizada, com fonte e versão. **Recusa** `postgres`,
`service_role`, `anon` e qualquer `auth.uid()` inconsistente. Ela
NÃO cria sessões ou claims: um ingress confiável deverá verificar
JWT/expiração/membership e fornecer sessão autenticada restrita à RLS.
Sem este ingress, não ligar o adaptador ao Telegram ou cliente externo.

Evidência de teste: `bash platform/services/api/scripts/test-hermes-brain-rls-sandbox.sh`
sobe PostgreSQL 16 **temporário**, com `--network none`, sem portas
publicadas; aplica migração e fixtures sintéticas; verifica que cliente
A não lê cliente B, usuário B não lê A, memórias pendentes, fontes
revogadas, expiradas e registros fora de company-scope não aparecem.
O papel `authenticated` não pode modificar registros e `anon` não
pode ler. O script remove a instância após concluir. Testes de
contrato da porta complementam o RLS real.

**Bloqueio restante:** o conector Supabase desta sessão acessa apenas
`softcom-grupo-erick`; este projeto é a **fonte empresarial**, NÃO o
destino do cérebro multi-tenant. A migração NÃO foi aplicada lá nem no
Postgres operacional da VPS. Para passar à fase de uso real, verificar
a identidade/propriedade do projeto Supabase canônico Hermes,
concluir credencial JWT/role sem bypass, executar a migração em staging
dele e provar ingestão mínima/consulta/gravação após reboot com
revogação/retention e auditoria. Apenas depois ativar canais,
espaço pessoal ou empresas externas.
