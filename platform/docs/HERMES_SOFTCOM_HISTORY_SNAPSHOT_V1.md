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