# Hermes – primeiro conhecimento histórico operacional (Supabase)

Status: **piloto em staging, snapshot privado datado; NÃO é uma conexão ao vivo nem RAG geral.**

## Origem / escopo
- Projeto de origem: `softcom-grupo-erick` / `yxmdrrwqxwzsdgcgskrm`.
- Origem: `softcom_import.cadastro_de_vendas`, coluna textual `data_da_venda`, `cancelado`, `lojaorigem`.
- Extraído por consultas SELECT agregadas supervisionadas; **não copia dados de clientes**, nem modifica tabelas Supabase.
- Cobertura analisada: registros entre 2026-01-01 e 2026-06-08. Não afirmar que há julho; junho é parcial.
- Contagem de cabeçalhos cadastrados, **não receita/faturamento, volume de itens, nem vendas líquidas**.
- Cancelados = somente strings marcadas "true", "1", "sim" ou "s". Demais situações contam como não marcadas, não como transações definitivamente válidas.
- Códigos de loja mantidos literalmente; "SPORTS-(DESATIVADO)" e "ERICK SPORTS" não são mesclados nem convertidos em filial conhecida.

## Operação privada e segurança
- Snapshot agregado de seis meses e seis códigos de loja armazenado exclusivamente no volume protegido do Telegram: `/var/lib/hermes-telegram/history-softcom.json`, diretório 0700, arquivo 0600.
- Credenciais do Supabase e dados financeiros de clientes **não** são incorporados ao snapshot ou ao repositório.
- `/historico`, `/historico lojas`, `/historico meses` e aliases limitados só respondem ao dono do bot em chat privado.
- A resposta mostra fonte, momento da extração, corte de dados e advertência de que **não houve nova consulta live**.
- O parser valida contagens inteiras, identidade de tenant, projeto e tabela, as seis lojas literais, seis meses e soma cruzada; rejeita dados alterados ou ausentes.
- Histórico não usa o leitor Compras/LotoIA e não debita a quota de 12 leituras/24h.
- Proibidos SQL arbitrário do Telegram, acesso a CPF/nomes/clientes ou uso operacional do snapshot para pagamentos, crédito ou decisão de estoque atual.
- Ingestão livre, documentação vetorial, RAG e conexão direta Postgres com role mínima **ainda não entregues**. Próximo incremento: servidor Hermes com credential de leitura isolada, consultas agregadas predefinidas e autorização auditada.

## Teste de aceitação
1. Rodar testes unitários de Telegram e CI completo antes de implantar.
2. Conferir a única instância de polling, identidade do proprietário, token e cursor persistente.
3. Carregar snapshot privado sintético em testes; dados reais somente no volume seguro da VPS.
4. Após implantar: `/status`, `/historico`, `/historico lojas`, `/historico meses`.
5. Conferir respostas na UI com fonte e horário, e auditar que nenhuma leitura de compras/loteria ocorreu.
6. Não fazer merge sem autorização humana.


## Leitura dinâmica V2 — implementação segura (feature flag desligada)

- Supabase: schema hermes_history, view daily_sales_v1, 658 agregações dia/loja,
  total conferido de 25.482 registros e 681 marcados como cancelados.
- Role hermes_history_reader NOLOGIN: USAGE somente no schema agregado e SELECT
  somente na visão. Não pode acessar tabelas individuais de vendas ou clientes.
- Role hermes_history_login de serviço: LOGIN, senha inicialmente desabilitada,
  sem privilégios de escrita ou BYPASSRLS, limite 2 conexões,
  default_transaction_read_only=on, timeout 5 segundos.
- Operador autenticado deve configurar senha forte diretamente no Supabase SQL
  Editor e protegê-la em arquivo 0600 na VPS. Nunca enviar senha no chat/Git.
- Adaptador hermes-softcom-live-reader.js e gramática em
  hermes-softcom-live-channel.js, com SQL estático parametrizado e whitelist
  de meses e lojas. Comandos explícitos /vendas 2026-05,
  /vendas lojas 2026-05, /vendas meses e /vendas loja CALCADOS 2026-05.
- Feature flag HERMES_HISTORY_LIVE_ENABLED permanece DESLIGADA até
  configuração de senha, TLS, driver PostgreSQL e teste E2E em staging.
- Máximo de 8 leituras dinâmicas por dia, quota durável própria.
  Verificação do proprietário ocorre antes da tentativa de leitura.
- Snapshot anterior /historico deve continuar funcionando; nenhuma operação
  de escrita/cliente individual ou SQL arbitrário permitido pelo Telegram.
\n- A leitura TLS exige CA Supabase em arquivo protegido HERMES_HISTORY_CA_FILE (0600), com rejectUnauthorized verdadeiro; certificado CA já conferido contra o endpoint e host específico (TLS 1.3, Verification OK). Para montar a imagem preparada, montar somente o script de entrada na pasta /app/scripts, nunca todo /app, preservando o driver pg da imagem.\n
- O endereço IPv4 do shared session pooler não pode ser calculado pelo
  nome da região. Antes de ativar, obter o hostname exato em Supabase >
  Project Connect > Session pooler e configurar a variável privada
  HERMES_HISTORY_POOLER_HOST na VPS; nunca deduzir aws-0, aws-1 etc.
- Pooler IPv4 usa username hermes_history_login.[PROJECT_REF], porta 5432;
  não é idêntico à conexão PostgreSQL direta, que requer IPv6.
- Login direto via IPv6 foi autenticado e confirmou 25.482 registros, mas
  o bridge Docker não tem rota IPv6. Primeiro teste com endereço de pooler
  presumido retornou XX000 ENOTFOUND tenant/user not found, indicando
  endereço de pooler possivelmente incorreto. Não ampliar a rede para
  host nem ativar o bot antes de verificar o endpoint real.

## Agregação privada de produtos — incremento V1
- Fonte: softcom_import.vendas_efetuadas, visão privada
  hermes_history.monthly_product_activity_v1, sem CPF/cliente.
- A migração já estava aplicada; validada no Supabase: 19.005 grupos
  código de produto / mês (2026-01 a 2026-06), leitura restrita permitida,
  anon/authenticated e tabelas brutas negadas.
- Maio/2026: 9.291 registros de itens, 148 marcados como cancelados,
  3.760 códigos distintos. Não confundir com vendas (cabeçalhos: 5.933).
- Consulta delimitada /produtos 2026-05: cinco produtos com mais registros
  de itens não marcados como cancelados; não faturamento, quantidade vendida
  conciliada ou estoque. Ordenação estável: count desc, código asc.
- Leitor executa exclusivamente SQL parametrizado na visão agregada; mês
  limitado a jan-jun/2026, sem identificadores livres, sem clientes.
- Reaproveita a mesma autorização do dono, quota histórica de 8/dia,
  TLS validado, rollback e bloqueio de execução em produção.
- A nova promoção usa
  scripts/deploy-hermes-telegram-products-staging.sh com --check,
  --deploy e --rollback, sempre com SHA exato e validação online.

## Analista histórico conversacional — incremento em homologação
- Visão privada hermes_history.monthly_commercial_2025_2026_v1, agregados
  mensais Softcom: ano de 2025 e jan–8 jun/2026.
- Métrica financeira: valor_pago_noncancelled_sum, soma do campo importado
  valor_pago em cabeçalhos não marcados como cancelados. NÃO corresponde
  a faturamento líquido conciliado, caixa recebido ou DRE.
- Templates em hermes-analyst-templates.js: period, compare, stores e
  products. Consultas parametrizadas em visões privadas, sem SQL livre.
- Linguagem natural delimitada: valor registrado, cancelamentos, comparação,
  ranking de lojas e itens. NÃO equivale ainda a conversa ilimitada por LLM.
- Contexto mínimo (template/período/métrica) e cache de plano: nenhum
  texto de conversa persistido. Cache 6 horas, máximo 16KB, quota de 24/dia
  para novas consultas de analista, 8/dia para comandos legados.
- Realidade 2025-01: 4226 registros / 55 cancelamentos / R$596590,41
  soma valor_pago; 2026-01: 4902 / 126 / R$682599,90.
  Junho/2026 e ano/2026 parciais.
- Novo script deploy-hermes-telegram-analyst-staging.sh: --check, --deploy,
  --rollback, HEAD exato, fail-closed, um único poller e testes online.
- Próximas dependências: LLM autorizado, JEV em modo sombra, memória real
  pessoal/empresarial e reconciliação Compras Homologação/Linx.

### Correção de isolamento e rollback imutável do analista
- Primeira promoção do analista falhou por EACCES: novo módulo copiado
  pela imagem como 0600 root-owned (worktree criado com umask 077).
- Dockerfile garante RUN chmod -R a+rX /app/src /app/scripts após COPY;
  conserva runtime uid 1000 sem root, read-only, cap_drop ALL.
- O backup pré-analista usa o script antigo no worktree legado intocado.
  A nova versão usa script congelado em BASE/releases por SHA exato,
  conferido via cmp e importado com uid 1000 antes de qualquer stop.
- Se gate de saúde falhar, diagnóstico privado .analyst-rollback-diagnostic.log
  modo 0600 antes do rollback. Sem aumento de heap nem nova PR.

### Regressão de contexto em conversa real e correção
- E2E do proprietário em 22/10/2026: 5 perguntas de analista foram
  atendidas com source+time; contexto após ranking anual de produtos
  interpretou incorretamente 'E em fevereiro?' como total de vendas.
- Correção: safeContext valida assunto (products/stores/compare/period),
  loja e segundo período. Acompanhamento sem mudança explícita mantém
  a dimensão anterior. Após ranking de produtos 'E em fevereiro?'
  continua produto, após ranking de lojas mantém loja, e após comparação
  jan/2025 vs jan/2026 muda os dois meses para fevereiro.
- Mudar explicitamente o assunto ('E quanto vendeu em fevereiro?')
  retorna o indicador financeiro mensal; não herda produtos.
- Contexto privado segue sem texto de conversas, somente IDs permitidos,
  métrica e períodos. UI de cancelamentos remove número duplicado.
- Deployment seguro v3 aceita como backup um executor anterior congelado
  em releases/analyst-<SHA>.js; não presume worktree mutável.

## Missão agent-first: planejador LLM governado, ainda não ativado
- src/runtime/hermes-governed-agent.js, integrado ao mesmo Telegram poller
  no intent desconhecido, somente com HERMES_AGENT_LLM_ENABLED=true.
- Por pedido: até 2 chamadas ao LLM (plano + síntese), máximo 3
  chamadas a ferramentas de leitura; histórico Softcom e resumo validado
  do app Compras Homologação. Os resultados verificados são passados
  como evidência, nunca como instruções executáveis.
- Nenhum SQL livre, Git, pagamento, publicação, WhatsApp, shell ou
  permissão de merge. Apenas owner privado, tenant grupo_erick, staging,
  kill switch obrigatório, readonly no Postgres.
- Modelos allowlist OpenAI gpt-4.1-mini/gpt-4.1, chave carregada
  exclusivamente do HERMES_AGENT_KEY_FILE modo 0600. A assinatura
  ChatGPT Plus não é uma credencial OpenAI API.
- Orçamento de 4 pedidos/dia e 2 chamadas LLM/pedido, 3 ferramentas/pedido,
  quota de 24 leituras analíticas/dia. Auditoria sem corpos de mensagens.
- Não afirma que Model Selection, Context Assembly ou JEV já
  deixaram modo de simulação. Conectar esses contratos existentes
  continua necessário; plugin JEV ChatGPT não é serviço da VPS.
- Testes offline de input livre, tools allowlist, evidências cruzadas
  de Softcom e Compras, synth, tenant/owner, quota e fail closed.
- Script deploy-hermes-telegram-agent-staging.sh usa SHA exato,
  preflight e rollback para backup preagent-safe-v4. REQUER
  arquivo privado ~/.hermes-telegram/secret/openai-agent-key 0600
  de hermesadmin. Sem credencial, NENHUMA promoção ao bot ativo.
- Chamada paga a modelo depende de autorização explícita do proprietário
  por instalação segura de sua própria credencial na VPS.

## Codex login (ChatGPT) - executor isolado de raciocínio
- Autenticação humana por device-auth do Codex; CLI oficial instalado
  fora do repositório. Status de login ChatGPT foi comprovado.
- Nao usar OAuth como API key: somente CLI oficial e franquia da conta.
- O modelo roda no contêiner isolado (UID 1000, rootfs somente leitura),
  sem montagens de senhas Softcom/Telegram/Compras.
- Conexão Hermes-Codex por Unix socket modo 0600, diretório host 0700,
  socket montado read-only no bot. Nao ha porta publicada.
- Codex exec ephemeral, ignore-user-config, ignore-rules, sandbox read-only,
  timeout de 80s e limite de tamanho de resposta.
- Canário real concluído: duas chamadas a Codex, SQL agregado histórico
  real e resumo Compras Homologação real, plano validado e síntese com
  fatos e hipóteses. Nenhuma ação de escrita; zero chamadas por API key.
- Rollout com SHA exato em deploy-hermes-telegram-codex-staging.sh,
  preflight de banco e socket, backup do bot anterior e rollback.
- Limites do agente: 4 turnos/dia, 2 chamadas LLM/turno, até 3 ferramentas,
  24 consultas SQL históricas por dia. Sem SQL livre.
- Memória contextual durável e JEV-Maestro continuam próximas missões.

## Business Insights V1 — cobertura equivalente + evidências empresariais persistentes
- O primeiro canário conversacional real do Codex em 22/10/2026 respondeu
  a uma pergunta aberta usando Softcom histórico e Compras Homologação.
  Auditoria Telegram: intent=governed_agent, answered, 1 turno contado.
- Correção necessária: a comparação 2025 vs 2026 misturava ano inteiro
  com 2026 parcial. O executor SQL oficial (visão agregada privada)
  passa a restringir automaticamente comparação anual a jan-mai
  completos nos DOIS anos. Junho/2026 parcial não é comparável a
  junho/2025 por agregado mensal; a consulta comparativa é negada.
- Modelo não pode contornar comparabilidade usando duas consultas
  anuais separadas. PLAN_PROMPT e síntese reforçam esse contrato;
  confiabilidade vem do executor, não apenas da redação do modelo.
- Evidência real Jan-Mai (Softcom): 2025 21940 registros, 238 cancelados,
  R$2730133.04 soma valor_pago; 2026 24148, 623, R$2956645.04.
  Valores importados NÃO são faturamento líquido nem DRE.
- Primeiro adaptador persistente de evidências empresariais:
  hermes-business-evidence-memory.js em staging, owner-only,
  tenant grupo_erick, scope enterprise. Lê apenas agregados verificados
  em ferramentas autorizadas, armazenados em JSON 0600 / state 0700.
  Cache com fonte, período, métrica, consulted_at, índice SHA de plano;
  até 12 observações, retenção 14 dias, limite 32KB. Não armazena
  corpo de mensagem Telegram, PII, decisões não aprovadas ou respostas
  do modelo como fatos. Recuperação restrita a contexto para escolher
  novas consultas; síntese continua exigindo evidência atual.
- Contratos oficiais Agent Memory Registry e Context Assembly permanecem
  SIMULATION; esse adaptador é somente o primeiro read-through real,
  não segundo cérebro pessoal ou empresarial completo.
- Rollout: deploy-hermes-telegram-business-memory-staging.sh
  com HEAD exato, CI verde, preflight sem root, banco/sockets, gateway
  memória/cobertura, backup antigo e rollback; 1 Telegram poller.

### Real owner follow-up failure and conversation router fix
- 22/10/2026 ingress at 19:19:04Z produced governed_agent, answered.
  Persistent enterprise evidence: three verified aggregate records in
  enterprise-scoped private JSON 0600. Owner follow-up at 19:19:40Z,
  however, was incorrectly captured by numeric business_analyst because
  the planQuestion parser ran before the advisory agent path.
- advisoryRequest now distinguishes explicit interpretation,
  evidence, risks, priorities, recommendations and contextual follow-ups
  from bare numeric comparisons. Slash commands remain deterministic.
  Owner check remains first; no model execution for other Telegram users.
- Acceptance test uses the two actual intent shapes in sequence:
  first LLM turn stores factual, sourced business evidence; second
  LLM turn recovers a prior evidence summary and still issues a
  fresh allowlisted SQL aggregate query. No Telegram text or PII stored.
- Annual matched-period reply now explicitly states jan-mai complete
  in both years; it no longer falsely warns unequal annual coverage
  after an intentionally matched comparison.
- Rollout in same PR, exact HEAD, existing bridge guardrails, preflight
  then health gates and rollback to v6.

### 22/10/2026 — bounded enterprise memory context overflow fix
- Owner follow-up reached governed_agent but received fail-closed generic
  answer. Bot and Codex sidecar were healthy; budget showed three LLM
  turns. No inference of unlogged provider failures is made.
- Reproduced a deterministic context error locally with THREE authorized
  synthetic evidence records: memory_context_oversize at MAX_CONTEXT=1500.
  Existing code took three summaries at 410 chars each, then failed
  instead of adapting to the budget; this occurs before LLM calls.
- Fix: trim summaries adaptively, retaining provenance and newest-first
  ordering; invalid tenant/source/store still fail closed. Do not delete
  or alter underlying historical records. Never store owner message body.
- Added three-evidence regression and rollout health gate; same PR, v8,
  exact HEAD / CI / old-release backup and automatic rollback.

### 22/10/2026 — rate-analysis quota incident and deterministic fallback
- Staging owner query at 20:20:18Z got a generic safety answer at 20:20:19Z.
  Agent daily budget already stood at 4/4 verified prior turns. No evidence
  of model or database failure in that request; agent_daily_quota triggered
  before model invocation but was swallowed by the generic Telegram handler.
- Preserve the 4-turn LLM limit; do not reset daily budget, fabricate an
  answer, retry Codex or silently grant more model calls.
- Owner-only, exact January–May 2025/2026 cancellation-rate requests use
  the existing parametrized annual matched-period comparison (cancelled)
  without running the model. The historical read quota is enforced and source,
  query time, denominators, rates and pp delta remain visible. Advice text is
  explicitly predefined and non-causal (no financial loss extrapolation).
- All other advisory prompts get an explicit UTC daily-model-quota explanation
  if blocked by that reason. Other failures keep fail-closed generic response.
- Specific regression: owner gate, planner bypass, unchanged model budget,
  historical budget accounted, quota exhaustion, malformed queries, source
  formatting and safety. Rollback-safe v9a staging script uses a unique backup
  name, keeping v9 and v8 backups intact; promotion still CI-gated.

## Segundo cérebro — memória de decisões humanas V1 (staging)
- Incremento privado de decisões explícitas no Telegram do proprietário.
  NÃO ativa o Agent Memory Registry oficial (ainda em SIMULATION), nem memória
  automática de conversas gerais.
- Comandos: /decisao, /decisao propor AREA | DECISAO | JUSTIFICATIVA,
  /decisao confirmar CODIGO, /decisao cancelar, /decisoes e
  /decisao ver CODIGO. Áreas: financeiro, compras, comercial, operacoes,
  marketing e rh.
- Só após confirmação separada é criado registro owner_confirmed_telegram
  com ID, área, decisão, justificativa, momento da proposta e confirmação.
  Proposta privada expira em dez minutos.
- Campos estruturados e explicitamente enviados pelo proprietário ficam
  no arquivo owner-decisions.json do volume protegido (0700/0600).
  Textos brutos de mensagens não entram em auditoria, Git nem nos prompts
  Codex. Proposta também é preservada temporariamente no volume privado.
- Rejeita links, e-mails, identificadores longos, tokens, instruções de
  pagamento/transferência/execução. Máximos: decisão 170 caracteres,
  justificativa 220, até 40 decisões confirmadas sem descarte automático.
- Esse registro NÃO autoriza nem realiza pagamento, compra, crédito,
  publicação, deploy, merge ou qualquer execução. Nem o LLM nem outras
  conversas podem inserir registros automaticamente.
- Owner privado verificado antes de ler ou salvar. Idempotência da confirmação,
  falha fechada em arquivo inválido, cota SQL/LLM preservada.
- Rollout: CI completo, HEAD exato, backup/rollback v10, um poller.
  Ainda não há busca semântica, responsabilidades por equipe, integração
  WhatsApp/Instagram nem reconciliação de decisões no ERP.

## Segundo cérebro — contexto de decisões humanas V11 (staging)
- Recuperação restrita ao proprietário autenticado e às análises empresariais
  já autorizadas ao agente Codex, sem nova ferramenta, modelo ou quota.
- Registros confirmados do owner-decisions.json são consultados em modo leitura,
  validados com esquema e tenant empresariais, selecionados por relevância do tema
  e limitados a dois registros e 800 caracteres serializados.
- Somente a etapa de síntese recebe contexto humano selecionado: ID, data,
  área, decisão, justificativa, proveniência owner_confirmed_telegram e flags
  de implementação não verificada e ausência de autoridade operacional.
  O planejador de novas consultas NÃO recebe essas decisões.
- Esta V11 altera deliberadamente a V10: registros humanos CONFIRMADOS
  relevantes podem entrar no prompt da análise do Codex em staging;
  propostas pendentes, mensagens brutas, dados pessoais, tokens e memória
  pessoal continuam excluídos. Nenhum registro entra em logs ou Git.
- As decisões são evidência de escolha humana, NÃO evidência de execução,
  conciliação financeira ou resultado; nunca integram a lista de fontes
  verificadas do Supabase. O modelo está proibido de segui-las como ordens.
- Corrupção, tenant incorreto, origem não humana, shape inesperado e
  flags falsas falham fechado. Sem alterações ao owner-decisions.json.
- CI e HEAD governam promoção; script V11 preserva backup separado V10
  e mantém rollback, um poller, conexões read-only e kill switch.

## Hermes Economia de Inferência V12 — regras e cache antes de LLM
- Fluxo já disponível antes da V12: consultas históricas via SQL
  parametrizado, cache analítico com verificação e TTL de 6h,
  comandos e memória de decisões owner-only sem LLM, limite Codex 4
  turnos/dia UTC com claim antes da chamada, Supabase limite próprio.
- Otimização V12: para perguntas analíticas com período explícito,
  um único indicador histórico, linguagem inequívoca e escopo
  permitido, o Hermes reutiliza o planner de SQL já homologado.
  O modelo generativo permanece somente para interpretar os dados
  depois de ferramenta com evidência fresca/validada.
- Fluxo antes: 1 chamada Codex para planejar + 1 para sintetizar.
  Fluxo otimizado para rotas aceitas: zero chamada de planejamento,
  1 chamada de síntese. Não altera cotas, operação autorizada, modelo
  de assinatura nem taxação desconhecida do Codex login.
- Escopo deliberado: metrics records/money/cancelled; periods
  2025/2026; planning via analyst.planQuestion + analyst.validate
  + governed.validateToolPlan; compras adicionadas apenas se
  explícitas. Múltiplas métricas, critérios ambíguos, temas não
  habilitados e operações sensíveis ainda exigem planejador
  governado ou negam acesso. Sem semantic cache de respostas geradas.
- Auditoria sem texto/PII registra apenas número de chamadas
  de modelo comprovadas quando há sucesso: llm_calls (1 ou 2)
  e planning_policy (static_verified_history_v1 ou
  governed_model_planner). Nunca inventar poupança de tokens:
  sem metadados de usage do provedor não há custo real medido.
- TypeSafe JEV foi validado via plugin do ChatGPT em ambiente
  separado para escolha estruturada de estratégia, mas a chave
  desse plugin NÃO é implicitamente acessível à VPS. Não ativar
  chamadas JEV na execução do Hermes sem credenciais e orçamento
  próprios e comparação de custo marginal com as regras locais.
- Referências de design: LiteLLM router/proxy (quotas, fallback,
  cache, multi-model), RouteLLM (rota custo/qualidade), TypeSafe
  System One (noul/choice/score), prompt caching de prefixos.
  Avaliar gateways multiprovedores somente quando existir
  mais de um modelo autorizado, preços, qualidade e telemetria.
- Sem merge automático; estágio staging-only, backups versionados,
  rollback automático, scripts com expected SHA e CI exato.

## Hermes V13 — síntese verificada e cache de resposta, staging
- Só a rota econômica de uma consulta histórica parametrizada permite cache
  de síntese. Fluxos de múltiplas ferramentas, planejamento ambíguo, ações,
  dados pessoais e consultas fora do escopo permanecem sem cache de resposta.
- Toda consulta que pretenda reutilizar síntese executa novamente a leitura
  SQL histórica homologada, consumindo a quota SQL aplicável, e valida a
  evidência com analyst.reply. Não usa o histórico do LLM como fonte de números.
- Chave SHA-256: pergunta literal, período/template, empresa, evidências de
  negócio, decisões humanas confirmadas relevantes e texto versionado do
  contrato de resposta. O campo de horário de coleta é ignorado na comparação
  dos valores, porque não modifica os registros; mudanças de números,
  decisões, contrato ou pergunta invalidam a chave.
- Cache V13 é protegido por volume de staging 0700/0600, TTL 20 minutos,
  até seis entradas, no máximo 3150 caracteres por resposta, com validação
  estrita de esquema e bloqueios de conteúdo sensível óbvio. O cache armazena
  apenas resposta final já validada e hashes, nunca a pergunta bruta.
- Reserva da quota Codex ocorre imediatamente antes da primeira chamada
  efetiva ao provedor. Cache com dados ainda coincidentes retorna zero
  chamadas e zero turnos de modelo. Cache ausente/expirado não recebe
  privilégio adicional: a chamada ao modelo conserva a mesma quota 4/dia.
- A resposta reutilizada recebe aviso explícito de reaproveitamento e
  nova validação do histórico. Eventos de auditoria registram cache=hit,
  llm_calls=0 e planning_policy=verified_answer_cache_v1, sem texto de
  pergunta/resposta. Não inferir custo em moeda ou tokens sem uso medido.
- A reutilização continua impossível se a consulta histórica falhar ou
  exceder sua própria quota. O conteúdo confirmado pelo proprietário não é
  alterado durante leitura. Não altera merge/produção, chave JEV, quota,
  kill switch ou provedores habilitados.
- Limitação: é cache exato com digest de fonte, NÃO pesquisa semântica.
  Benefício real depende da repetição de perguntas e de evidências iguais.

## Economia de inferência V14 — FinOps real, sem tokens inventados
- A execução real em staging usa **Codex Login por socket local**; o
  bridge atual devolve texto, não devolve contagem de tokens, custo
  faturado ou identificador do modelo subjacente. Por isso a V14
  **não calcula custo/tokens** a partir do tamanho da resposta.
- O novo registro empresarial `ai-finops-daily.json`, privado no volume
  de staging (0700/0600), acumula até sete dias de métricas agregadas:
  quantidade de chamadas reais ao modelo, sucesso/falha, latência,
  solicitações ao fluxo de análise, rotas de planejamento fixo/modelo,
  cache de síntese comprovado e uso de zero chamadas ao modelo.
  Nenhum texto de mensagens, respostas, dados pessoais, tokens ou chave
  pode entrar nessa estrutura. Dados anteriores à ativação não são
  inventados nem reconstruídos.
- O comando owner-only `/economia` lê essas métricas localmente sem
  fazer chamada ao Codex, Supabase, TypeSafe JEV ou outras ferramentas.
  Se o registro estiver inválido, apresenta métricas indisponíveis.
- A medição ocorre ao redor de cada chamada real de `model.chat`,
  inclusive em falhas. As respostas reutilizadas de cache não
  aumentam o contador de chamadas. A quota existente continua sendo
  reservada imediatamente antes da chamada ao provedor.
- A coleta é **observabilidade, não fonte de faturamento**. Sem
  telemetria de usage do provedor, tokens, gasto em USD/BRL e modelo
  exato permanecem marcados como indisponíveis. Uma falha opcional
  de registro não autoriza modelo extra, mutação ou bypass da quota.
- Roteamento modelo-ideal: o Hermes já tem modos zero LLM, síntese
  simples e planejador governado. Não habilitar novos modelos,
  fallback externo, financiamento cruzado, nem trocar o provedor
  autenticado sem contratos, chaves, preços, quality gates e
  autorização humana específicos. O plugin JEV do ChatGPT não
  fornece automaticamente credencial à VPS.
- Implantação isolada no mesmo PR do segundo cérebro: expected SHA,
  CI completo, rollback V13 preservado, um poller, staging-only,
  fail-closed e sem merge.

## Hermes V15 — contabilizar rotas determinísticas sem gastar Codex
- Correção de lacuna da V14: o relatório `/economia` antes
  contabilizava apenas o fluxo governado; consultas diretas
  históricas, Compras/LotoIA, memória owner-only e comandos de
  ajuda/status podiam produzir respostas sem aparecer no painel.
- A V15 acrescenta contadores separados de **respostas diretas**
  (histórico, dois apps homologados, decisões humanas e comandos
  informativos) e de acertos verificados de cache determinístico.
  Não inclui o próprio `/economia` na contagem. Uma resposta
  contabilizada NÃO garante que a origem retornou dados válidos:
  também pode ter sido uma resposta de limite/erro; não exibir
  isso como economia financeira ou sucesso empresarial.
- Sem criar LLM, alterar quotas, capturar conteúdos das mensagens
  ou persistir identificadores pessoais. Continua permitido ao
  proprietário consultar `/economia` com zero chamadas.
- O esquema de métricas migra de V14/schema=1 para schema=2,
  preservando os agregados coletados e iniciando contadores diretos
  em zero. Validação fail-closed contra tenant incorreto, forma
  inesperada, overflow ou somas incompatíveis. Arquivo 0600;
  staging e histórico agregado de até sete dias.
- Homologação E2E sintética: `/decisoes`, `/ajuda`, `/economia`
  sem Codex e sem SQL; duas perguntas idênticas de histórico
  resultam em uma única consulta SQL, um cache-hit e zero turnos
  do Codex. O teste de integração preserva o limite de 4 turnos.
- Rollback versionado V14; mesmas pré-condições de SHA exato,
  CI obrigatório, único poller, leitura empresarial, kill switch
  e autorização humana para merge e eventuais operações reais.

## Hermes V16 — diagnóstico financeiro determinístico do proprietário
- Comando `/diagnostico` atendido somente ao proprietário autenticado.
  Retorna indicadores derivados de snapshot privado previamente extraído
  e validado: total, cancelados, taxa de registros marcados cancelados,
  taxas mensais, extremos apenas entre meses completos (jan–mai/2026),
  diferença em pontos percentuais e última decisão financeira
  **confirmada por humano**, quando existente.
- Sem Codex/JEV, sem SQL adicional, sem requisição externa, sem
  consumo das quotas Codex e histórico online. A resposta informa
  extração, corte em 8 jun/2026, junho parcial, julho ausente e
  que o snapshot não é conciliação, faturamento ou prejuízo.
- Falha fechada se o snapshot não passar em `safeHistorySnapshot`,
  se a fonte/tenant divergir, se os totais não coincidirem ou se
  a memória de decisões humanas estiver inválida. Nenhum dado é
  inferido, nenhuma proposta pendente é promovida a decisão e
  nenhuma ação empresarial é autorizada ou executada.
- Auditoria registra apenas intent `business_diagnostic`;
  FinOps agrega uma resposta histórica direta sem LLM. Nenhum
  conteúdo do diagnóstico é salvo em logs ou no novo cache.
- Implantação staging-only via script de SHA exato, CI obrigatório,
  validação sintética isolada, backup V15 para rollback e um poller.

## Hermes V17 — diagnóstico por códigos originais do Softcom, sem LLM
- Comando proprietário `/diagnostico lojas` usa SOMENTE snapshot
  empresarial privado já validado por `safeHistorySnapshot`.
  Não faz SQL, não invoca Codex ou JEV, não cria novas decisões e
  não consome quotas de modelo, SQL ou apps.
- Exibe exatamente os seis códigos históricos originais
  `CALCADOS`, `SIRINHAEM`, `MAGAZINE`,
  `SPORTS-(DESATIVADO)`, `ERICK SPORTS`, `VARIEDADES`
  na mesma ordem da origem, contagens e taxas relativas de registros
  marcados cancelados. Confere soma ao total do snapshot.
- NÃO converte esses rótulos em loja física, cidade ou unidade de
  negócios do ERP. Os dois nomes SPORT(S) podem representar fases
  diferentes e não devem ser juntados sem conciliação. O snapshot
  não possui cruzamento `mês x código`; portanto não atribuímos o
  pico de maio a nenhuma loja. Percentuais são indicadores
  descritivos, não perdas monetárias ou ranking empresarial.
- Aviso de validade: extração datada, junho incompleto e julho
  ausente; alertas são sugestões reversíveis para revisão humana,
  não ações nem causas comprovadas.
- Integra FinOps como `business_diagnostic_store` na categoria
  direta de histórico. Registro não inclui texto de perguntas,
  nomes/códigos de loja, números ou resposta; owner-only, 0600.
- Testes unitários e E2E: soma e percentuais exatos, recusa
  tenant/snapshot adulterado, proprietário autorizado, quota
  Codex e SQL intactas e dados ausentes no log.
- Staging-only, promoção pelo script com SHA e CI obrigatório,
  verificação sintética e rollback isolado da versão V16.

## Hermes V18 — cruzamento mês × código do Softcom (somente leitura)
- Nova operação do proprietário: `/diagnostico cruzamento`. Consulta
  dinamicamente `hermes_history.daily_sales_v1` usando a conexão
  PostgreSQL previamente homologada com role de leitura agregada.
  NÃO usa o conector MCP para transferir o agregado ao ambiente:
  nenhuma importação de resultados nem acesso à tabela original
  foram acrescentados à VPS.
- Shape `matrix` tem SQL estático, janela 2026-01-01 a 2026-06-08,
  máximo de 36 células (6 meses × 6 códigos), timeout de 5 segundos,
  sem parâmetros de SQL arbitrário, clientes, usuários ou texto livre.
  A quota existente de 8 leituras diárias simples permanece em vigor
  e o claim ocorre antes de qualquer consulta real.
- O parser rejeita códigos/meses inesperados, negativos, cancelados
  superiores aos totais, duplicações, excesso de linhas ou fontes
  incompatíveis; o renderizador exige reconciliação EXATA dos seis
  totais mensais e seis totais por código com o snapshot privado
  datado. Divergências falham fechado, sem estimar números.
- Mostra frações cancelados/registros em cada código histórico por
  mês e variação abril→maio; junho parcial e julho ausente.
  NÃO identifica unidade física atual, valor financeiro, estorno
  ou motivo de cancelamento. `obs`/`mensagem` não foram
  confirmados como razões de cancelamento e não são consultados.
- A única capacidade de banco utilizada é a view autorizada;
  zero chamadas ao LLM/JEV. Não persiste células no repositório,
  memória privada ou auditoria. FinOps registra somente
  `business_diagnostic_matrix` como resposta direta histórica.
- Testes sintéticos abrangem owner-only, cross-check e rejeição
  de dimensões, SQL parametrizado/fixo e consumos de quota.
  Promoção staging V18 condicionada a HEAD/CI e rollback V17,
  um poller, sem merge automático nem mutações empresariais.

## Hermes V19 — alertas operacionais determinísticos (sem Codex/JEV)
- O comando proprietário `/alertas historicos` reutiliza a operação
  read-only homologada `matrix` da view `hermes_history.daily_sales_v1`.
  Não requer API Linx, escrita no ERP, nova credencial, nem autorização
  de pagamento; mantém a quota de leituras históricas e uma só consulta.
- Antes de classificar qualquer sinal, reconcilia as seis somas mensais
  e seis somas por código com o snapshot empresarial conhecido. Se
  houver divergência, falha fechado e não apresenta indicadores.
- Duas classificações **descritivas**, exclusivamente abril→maio/2026:
  (a) variação de taxa quando ambos os meses têm no mínimo 100
  registros, diferença de cancelamento >= 2 pontos percentuais e
  crescimento >=10 registros marcados cancelados;
  (b) alteração de cobertura quando um mês tem menos de 20 registros
  e o outro possui >=100. Mudanças de cobertura nunca são apresentadas
  como taxa comparável. Limiares explícitos, conservadores e versionados.
- A V19 não infere causas, fraude, prejuízo financeiro, estorno,
  irregularidade de funcionário ou unidade física. A decisão humana
  financeira confirmada aparece como contexto, sem conferir ao
  Hermes autoridade de execução.
- Somente ao proprietário vinculado, saída limitada a 3150 caracteres,
  sem informações pessoais, sem cache de conteúdo, sem texto em
  auditoria/FinOps; classificado como resposta histórica direta.
- QA sintético: exemplos com quatro taxas comparáveis e dois casos de
  troca brusca de cobertura; falha de reconciliação, tenant divergente,
  decisão proposta versus confirmada, bloqueio de usuário externo,
  quota SQL e zero LLM. Staging com V18 preservada para rollback.
