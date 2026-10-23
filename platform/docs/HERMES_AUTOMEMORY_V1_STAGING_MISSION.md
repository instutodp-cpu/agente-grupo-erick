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
