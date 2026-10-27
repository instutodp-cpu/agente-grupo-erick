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
