# Hermes — leitura local de exportações ChatGPT e Claude (V1)

**Estado:** implementação de normalização e prévia local testável; NÃO é integração contínua, não é serviço publicado, não tem acesso automático a contas pessoais e **não persiste dados no Supabase**. Este incremento reutiliza o plano de memória/tenant existente sem criar novo banco, nenhuma fonte fictícia e nenhuma missão nova.

## Entrada de dados autorizada

As exportações oficiais do ChatGPT e do Claude são obtidas pelo titular das respectivas contas. Não pressupomos que Composio, OpenAI API, Anthropic API ou DeepSeek API possam ler o histórico pessoal anterior da interface web. O usuário deve selecionar a fonte pessoal, autorizar seu armazenamento e identificar a conta de origem. **Exportações não são comprovantes independentes de veracidade**: conversas antigas podem conter erros, conteúdo malicioso ou instruções obsoletas.

- ChatGPT: extrair **localmente** do ZIP oficial o arquivo \`conversations.json\` ou seus arquivos numerados; o leitor V1 entende o objeto \`mapping\` e nós com \`message.author.role\`, \`content.parts\`, IDs e parent node.
- Claude: extrair **localmente** \`conversations.json\`; o leitor V1 entende \`chat_messages\`, \`sender\`, \`text\` e blocos de conteúdo com \`type=text\`.
- DeepSeek e Manus **ainda não implementados**, pois não se presume um formato estável ou API de histórico pessoal. Não usar scraping de sessão/cookies.
- PDFs, áudio, imagem, arquivos e blocos multimodais não são importados como texto inexistente; \`unsupported_text_messages\` torna cobertura parcial visível.

## Prévia offline sem upload

A partir de \`platform/services/api\`, em computador controlado pelo próprio usuário:

\`\`\`bash
node scripts/inspect-ai-conversation-export.js \
  --provider chatgpt --file /caminho-privado/conversations.json --owner owner_local
node scripts/inspect-ai-conversation-export.js \
  --provider claude --file /caminho-privado/conversations.json --owner owner_local
\`\`\`

O comando aceita JSON de no máximo 32 MiB por arquivo, exige arquivo regular sem symlink e imprime SOMENTE estatísticas, sem mensagens, títulos ou caminho. \`owner_local\` é um namespace LOCAL, **não é identidade autenticada**. Para arquivos grandes, é preciso fracionar a origem de forma comprovável; não truncar silenciosamente nem afirmar cobertura total. É proibido subir ZIPs, transcrições ou tokens a GitHub, CI, logs, suporte técnico ou repositórios. **Não extrair ZIPs não confiáveis na VPS** sem extrator com limites de entrada, tamanho total, razão de compressão e validação de path traversal.

## Contrato reutilizável de normalização

\`src/runtime/hermes-ai-conversation-export-reader.js\` expõe \`normalizeExport({provider,conversations,grant})\`, sem I/O ou LLM. Retém texto das mensagens user/assistant, identificador opaco da conversa/mensagem derivado por SHA-256, vínculo pai/filho de mensagens ChatGPT, timestamp quando informado e indicação de proveniência. Outros autores e blocos não textuais não entram como conteúdo. Recusa duplicidades, ids inválidos, mais de 1.000 conversas, mais de 1.000 mensagens/conversa ou texto acima de 16.000 caracteres por mensagem. Campos \`classification:'confidential'\`, \`visibility:'owner_only'\`, \`memory_status:'unreviewed'\` e \`tenant_id:'personal::<user_id>'\` são obrigatórios.

**Não permitir promoção para \`grupo_erick\` ou \`client::<cliente>\` por palpite do modelo, coincidência de nome ou propriedade da conta.** Classificação do trecho, permissão de reutilização corporativa, tratamento de dados pessoais e memória permanente são passos posteriores, governados no Maestro.

A forma \`grant.authenticated=true\` é SOMENTE uma verificação de formato; em um ingress real, identidade e grant são emitidos pelo servidor após validar JWT, consentimento de fonte, usuário e workspace. Valores fornecidos em prompt, exportação, flag CLI ou pela IA não constituem autorização. O comando CLI só cria um grant artificial para cálculo **local** e entrega exclusivamente sumário \`credential_authorized:false\`, sem armazenamento.

## Diferença entre histórico e memória

A normalização retorna \`status:'normalized_unpersisted'\`, \`raw_export_persisted:false\`, \`memory_written:false\`, \`requires_review:true\`, \`provider_api_called:false\`, \`cross_workspace_shared:false\`. Um futuro importador autenticado e consentido deverá guardar mensagens históricas em uma coleção própria com RLS individual e provenance, hash estável e de-duplicação; somente resumos curados poderão virar \`inbox_candidates\` pendentes via \`hermes-brain-inbox-propose\`, e somente após revisão governada poderão ser publicados como \`memory_items\`.

Não incluir dados privados em fixtures, respostas HTTP ou relatórios de teste. Testes de schema usam exclusivamente dados sintéticos.

## Próxima dependência para uso pessoal real

1. Autorização expressa do titular para leitura e persistência de ChatGPT/Claude como fontes pessoais, separadamente.
2. Entrega controlada do ZIP/JSON privado (não via GitHub) e análise da estrutura real sem registrar conteúdos em logs.
3. Armazenamento **privado** com verificação de vínculo, RLS por usuário, retenção/exclusão, indexação e cobertura auditáveis.
4. Consultas pelo Hermes/Telegram condicionadas a autenticação e a uma escolha explícita do workspace pessoal; contas corporativas não podem ver esse contexto.

**Composio na VPS:** pode futuramente mediar ferramentas OAuth e suas scopes por conexão, mas não deve ser usado para supor acesso ao histórico completo das interfaces ChatGPT, Claude, DeepSeek ou Manus. Ainda não houve conexão Composio à VPS nesta PR.

## Incremento V1.1 — identidade real e ramificações ChatGPT

O export do ChatGPT pode usar `conversation_id` em vez do antigo `id`. Os dois formatos são aceitos, mas se ambos estiverem presentes e divergirem o lote é negado. O JSON original pode conter várias respostas regeneradas para uma pergunta; o leitor percorre `current_node` e `parent` para identificar o ramo selecionado e marca cada mensagem como `selected`, `alternate` ou `unknown` (quando não há `current_node`). Um nó inexistente, ciclo ou ponteiro inválido interrompe a prévia. **Respostas alternativas nunca devem ser combinadas na narrativa como se fossem a escolha final.**

A prévia local mostra apenas contagens de mensagens selecionadas, alternativas e com ramo desconhecido. Imagens, arquivos e outros blocos que acompanhem texto geram contagem explícita em `omitted_nontext_parts`; uma mensagem mista não produz uma declaração falsa de cobertura integral. Não há conexão, envio ou persistência de dados pessoais neste incremento.


## Incremento V2 — persistência pessoal preparada, não implantada

Migração revisável: platform/migrations/hermes/049_create_personal_conversation_archive.sql.
Os dados históricos pessoais terão duas tabelas separadas no schema hermes_brain:
personal_import_consents e personal_conversation_messages. Não se inserem conversas
em memória empresarial nem no catálogo de fatos aprovados.

O tenant pessoal será gerado pelo próprio banco como personal::<Supabase auth.uid()>.
RLS ativado e forçado, políticas para authenticated condicionadas ao auth.uid()
real, concessões por usuário e por provedor, conteúdo imutável, status unreviewed
e classificação confidential / owner_only. Não há privilégios para service_role
ou bot empresarial no novo caminho.

O usuário terá mecanismos de consentimento por fonte; revogação impede novas
importações e exclusão do consentimento apaga em cascata o histórico sob aquele
grant. A autorização dada nesta conversa NÃO constitui credencial ou sessão
Supabase válida e não cria o registro de consentimento no banco: é preciso
vincular a ação ao dono real via login pessoal.

src/runtime/hermes-brain-personal-conversation-import.js utiliza a
transação autenticada existente (sem service_role), consulta o consentimento
ativo no banco, normaliza a exportação por fonte, limita a 500 mensagens e
2 MiB por transação, valida hashes de conteúdo antes/depois, e gera recibo
apenas com contagens. Mudança em uma mesma referência causa ROLLBACK.
Conteúdo de mensagem não deve aparecer em retornos HTTP, logs ou relatórios.

Estado atual: migração não aplicada, espaço pessoal ainda não provisionado,
nenhum ZIP ou JSON real recebido, nenhuma conta pessoal conectada,
endpoint privado de upload ainda não implementado, nenhuma operação E2E real.
Esta camada não autoriza ingestão via Telegram, chat ou Composio.

Para homologação: login Supabase pessoal independente de Grupo Erick,
consentimento autenticado distinto por provedor, aplicar migração revisada,
abrir importação privada de lotes, verificar autorização entre dois usuários
e revogação/remoção completas antes de liberar pesquisa.


## Incremento V2.1 — busca pessoal autenticada, ainda sem implantação

Adicionado `src/runtime/hermes-brain-personal-history-search.js`:
recupera exclusivamente registros não aprovados da fonte pessoal escolhida,
por sessão PostgreSQL/JWT autenticada, com consulta SQL parametrizada,
limite de 1–10 resultados, conferência repetida de `auth.uid()`,
validação de hashes SHA-256, visibilidade `owner_only` e selo de confiança
`unreviewed_personal_archive`. A resposta ao titular pode conter o texto
original como dado não confiável; **não é instrução operacional, memória
confirmada ou autorização de execução**.

A política SELECT da migração foi reforçada: revogar o consentimento de
uma fonte agora bloqueia **também a pesquisa** no histórico dessa fonte,
não somente a importação. A exclusão do consentimento remove os arquivos
históricos associados em cascata. Um índice de pesquisa textual permite
consultas por palavras, sem pressupor busca vetorial/RAG.

O importador ganhou limite de tamanho **antes** de abrir transações, além
do limite por lote já existente. O futuro ingresso HTTP autenticado deve
rejeitar cargas acima do limite antes de fazer JSON.parse.
Importações grandes exigirão divisão em lotes com verificação de completude.

Estágio: **GitHub/testes**, não deploy em Supabase ou VPS; não há endpoint
público, fluxo de autenticação pessoal habilitado, upload nem leitura real
de históricos do usuário. Não usar service_role ou bot Grupo Erick
para executar este caminho.


## Incremento V2.2 — integridade conferida pelo próprio PostgreSQL

A migração de armazenamento pessoal agora exige que cada `content_digest`
seja exatamente o SHA-256 (UTF-8) do campo `content`, por uma constraint
nativa do PostgreSQL. Isso protege contra gravações diretas que tentem
contornar o importador Node; apenas verificar a aparência de um hash não
é suficiente. O conteúdo continua privado, `owner_only` e `unreviewed`.

O primeiro teste de aplicação da migração em um PostgreSQL 16 isolado e
sem rede foi concluído para a versão anterior à nova constraint. Os testes
de RLS por sessões simuladas NÃO foram executados: a ferramenta remota
bloqueou a simulação; nenhum resultado sobre isolamento real deve ser
inferido daí. O contêiner de QA e seus arquivos foram eliminados.

Antes de implantar a migração em Supabase, validar essa nova constraint em
PostgreSQL descartável, e depois executar testes autenticados RLS de dois
usuários por canal autorizado. A aprovação do CI do repositório não equivale
a produção pronta.


## Evidência adicional de PostgreSQL descartável (27/10/2026)

Depois de detectar e corrigir um erro de sintaxe na migração candidata,
a versão com `personal_digest_matches_content` foi executada com sucesso
em PostgreSQL 16 local à VPS, usando contêiner descartável com rede desativada,
sem vincular portas ou dados reais. Um INSERT de texto sintético com hash
SHA-256 correspondente foi aceito; um segundo INSERT sintético com hash
inconsistente foi recusado pela constraint. O contêiner foi eliminado ao fim.

**Escopo limitado da evidência:** comprovação de SQL/constraint e integridade
de conteúdo, não de autenticação Supabase nem de isolamento RLS entre pessoas.
A simulação de identidades na ferramenta remota foi bloqueada, portanto
continua pendente teste autorizado de RLS com sessões genuínas em ambiente
seguro. Produção, memória empresarial e dados privados permaneceram intocados.


## Incremento V3 — operações pessoais autenticadas no staging (não implantado)

Migração candidata `050_create_personal_archive_authenticated_rpc.sql`:
cinco RPCs públicos do Supabase exclusivamente para `authenticated`,
todos com `SECURITY INVOKER`, `auth.uid()` e RLS existente.
Operações: `hermes_personal_source_status`,
`hermes_personal_source_consent`,
`hermes_personal_source_revoke`,
`hermes_personal_source_erase`,
`hermes_personal_history_search`.

As funções não aceitam `tenant_id`, `company_id`, `user_id` ou
chaves de autenticação como argumento. A identidade vem somente de
`auth.uid()`. Nenhuma função cria memória aprovada, importa ZIPs,
altera Grupo Erick ou chama APIs externas. A escolha da plataforma é
estritamente `chatgpt` ou `claude`. Revogar remove a leitura;
excluir remove registro de consentimento e mensagens vinculadas.

A interface `brain-web/personal.html` e o JS correspondente
`personal-app.js` são **página separada** do piloto empresarial
(que continua em `/brain/`). A página pessoal usa login OTP já
existente, sem criação automática de usuários, não persiste sessão
em storage local, nunca apresenta arquivo pessoal a usuários
não autenticados e exige confirmação explícita antes de consentir
ou apagar uma fonte.

A página de histórico pessoal **não tem botão de upload**: até o
ingresso de arquivo estar autenticado, a migração 049 e a RPC 050
serem homologadas em ambiente confiável e o isolamento RLS ser
verificado entre usuários reais, o Hermes não deve receber ZIPs.
O staging não está publicado com esse novo código e o Supabase
ativo não tem essa migração; as funções de autenticação da página
não funcionarão no site até passar os gates de implantação.

Evidência: ambas as migrações 049+050 executadas com sucesso em
PostgreSQL 16 descartável com rede desativada e sem dados reais;
essa comprovação é de sintaxe/privilégios ao criar, **não** equivale
a autenticação JWT/RLS E2E nem confirma eliminação real de dados.
Nenhum segredo novo é necessário; a chave pública Supabase já
usada no piloto não é service_role.


## Incremento V3.1 — homologação de RLS no PostgreSQL do CI

Adicionado `test/hermes-personal-rls-postgres.integration.test.js` à
matriz **já existente** `postgres-persistence` do Hermes. Esse job usa
PostgreSQL 16 descartável, dados sintéticos, schemas isolados, e executa
as migrações `049` e `050` como SQL real. O teste impõe identidades
fictícias distintas com o papel `authenticated` para verificar:

- A e B consultam exclusivamente seus próprios registros e fontes;
- B não pode conceder consentimento, escrever ou revogar dados de A;
- RPC de pesquisa não retorna histórico de outro usuário;
- após revogação, a leitura e novas escritas são bloqueadas;
- exclusão da fonte retira registros associados por cascata e não afeta B;
- o SHA-256 inconsistente é rejeitado pela constraint do PostgreSQL;
- papéis `anon` e de leitor empresarial não recebem acesso;
- RLS fica `ENABLED` e `FORCED` nas duas tabelas.

**Interpretação precisa:** o teste comprova comportamento de RLS
em um banco PostgreSQL real do CI, usando identidade de teste simulada.
Ele **não comprova** assinatura JWT externa, login real Supabase
do proprietário, implantação nem isolamento ponta a ponta em produção.
Sem as duas etapas separadas — validação JWT e homologação do
ingresso autenticado — o upload pessoal permanece bloqueado.

Os testes nunca incluem históricos reais, credenciais ou mensagens
privadas; não provisionam usuário real e não ligam a aplicação à
instância de produção.


## V3.2 — plano de lotes recuperável para históricos grandes

O módulo `hermes-brain-personal-archive-batch-plan.js` prepara em memória
lotes de até 500 mensagens textuais e 2 MiB, sem enviar arquivos nem registrar
conteúdo em logs. Ele percorre todas as conversas da fonte, mantendo IDs de
origem estáveis e contando mensagens textuais, mídia não importada e conteúdo
não recuperável. Nenhuma conversa é ignorada para atingir os limites: se uma
única conversa for excessiva, a preparação falha explicitamente para revisão,
em vez de reportar uma importação completa falsa.

`storePlannedPersonalArchive` reutiliza o importador transacional existente,
com conferência de consentimento ativo e sessão autenticada **em cada lote**.
Uma falha em lote posterior não desfaz os anteriores já confirmados; repetir
a mesma fonte utiliza IDs estáveis e `ON CONFLICT DO NOTHING`, contabilizando
duplicações e retomando as mensagens não gravadas. O recibo final retorna
somente contagens e cobertura, nunca textos nem títulos.

**Limites restantes:** a leitura JSON local atual está limitada a 32 MiB
por arquivo; a preparação de um único objeto conversa com mais de 500
mensagens suportadas exige estratégia de fracionamento especial ainda não
implementada. Nenhum fluxo de envio/streaming, JWT real no servidor,
conexão de usuário pessoal, importação ou implantação foi liberado
neste incremento. O planejamento guarda as conversas confidenciais
em um WeakMap privado do módulo, sem incluí-las nos recibos de lote.
`JSON.stringify(plan)` e a inspeção comum só mostram metadados numéricos,
nenhum texto ou título. O conteúdo continua em memória durante a execução;
o ingresso não pode imprimi-lo em logs, telemetria ou respostas.

Para ativação, continuam pendentes autenticação pessoal real no Supabase,
revisão do ingresso privado, aplicação governada das migrações 049/050
e verificação ponta a ponta com consentimento por provedor.


## V3.3 — recibos sem texto confidencial

Antes, `planPersonalArchiveBatches` retornava objetos contendo
`batches[].conversations`. Isso poderia vazar o histórico caso algum
chamador registrasse ou serializasse o plano por engano. Agora, cada
recibo de lote contém exclusivamente contagens/tamanhos, enquanto os
objetos confidenciais permanecem em um `WeakMap` privado que só o
importador do módulo consegue recuperar. Testes com marcadores textuais
sintéticos verificam que `JSON.stringify(plan)`, inspeção padrão,
retornos e contagens não expõem as mensagens; a importação idempotente
em transações autenticadas continua funcional.

Não se trata de criptografia do processo nem de autorização para
exportar dados reais: o conteúdo ainda precisa de um ambiente de
execução seguro, JWT validado, fonte autorizada e política de retenção.


## V3.4 — login pessoal verificável sem publicar o arquivo

A página `/brain/personal.html` espera a inicialização de uma sessão
Supabase Auth via `getSession()` (somente sincronização inicial), depois
confirma o titular com `getUser()` (requisição verificada ao Auth).
A tela diferencia a identidade autenticada da disponibilidade das RPCs
`hermes_personal_*`. A ausência da migração `050` ou uma negativa de
permissão **não** transforma login válido em erro de autenticação:
o titular permanece identificado e pode encerrar sua sessão, mas a interface
mantém autorização, consulta e exclusão privadas desabilitadas.

O desbloqueio dessas operações exige que a RPC real de status responda
corretamente para duas fontes separadas; somente `getUser()` não as ativa.
O upload de exportações continua ausente e bloqueado. Testes com Supabase
simulado verificam tanto login sem módulo instalado quanto recusa de ações
manual ou programaticamente disparadas nessa condição. A PR ainda não foi
implantada e nenhum histórico pessoal foi acessado.
