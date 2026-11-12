
## Codex falhou: classificação e leitura alternativa
- A cota interna do Hermes não estava esgotada: 1/4 análises UTC e uma
  chamada ao provedor falhou em 2026-10-23. O Codex estava logado e o
  bridge saudável. A causa exata da falha do provedor antigo não é recuperável.
- O bridge atualizado classifica somente categorias fixas (quota, rate limit,
  autenticação expirada, indisponibilidade, timeout, resposta inválida).
  Nunca retorna ou persiste stderr, argumentos, prompts, tokens ou auth.json.
- Somente falhas allowlisted do Codex ou a cota interna permitem fallback
  read-only sem LLM. Validação, permissão ou fonte inconsistente continuam
  fail closed.
- Fallback lê exclusivamente até duas memórias auto-curadas da sessão owner
  do Grupo Erick; todas com origem/tenant/validade verificados. Não executa
  nenhuma consulta externa, não afirma análise IA nem números atuais.
- Auditar o **código de falha** somente em audit.jsonl, nunca prompts/PII.
- A CLI Codex roda em container próprio; a correção do bridge necessita
  release e rollback SEPARADOS do único poller do Telegram. Enquanto o bridge
  antigo permanecer ativo, o código novo no poller trata o status genérico
  como indisponibilidade, sem afirmar cota externa esgotada.
