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
