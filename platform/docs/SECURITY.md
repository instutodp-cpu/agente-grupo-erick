# Hermes AI Platform v2 — SECURITY

Documento de princípios e requisitos de segurança. Toda funcionalidade deve
respeitá-los; PRs que os afetem devem atualizar este arquivo.

## 1. Princípios

1. **Least privilege** em tudo: usuários, serviços, agentes, MCPs.
2. **Segredos fora do alcance** de agentes e do código. Injetados por
   gateways/adapters; nunca logados nem retornados ao modelo.
3. **IA não é fonte da verdade** nem executa ações críticas sem controle.
4. **Auditoria de tudo** que é sensível, com `trace_id` e sem PII em claro.
5. **Reversibilidade**: qualquer integração pode ser desabilitada por política.

## 2. Autenticação e autorização

- AuthN de usuários e serviços no Ingress.
- AuthZ multidimensional: **papel, departamento, loja, dado, ação**.
- Capacidades declaram `permissions`, `riskLevel` e `requiresApproval`.
- Ações sensíveis exigem **human-in-the-loop** (aprovação explícita).
- Endpoints administrativos protegidos por segredo forte enviado por header;
  comparação em tempo constante; segredo nunca logado.

## 3. Dados e privacidade

- **Fonte transacional** (Postgres/Supabase) acessada por **usuário read-only**
  quando a operação é de leitura.
- **SQL gerado por IA** passa por guardrails: só leitura, allowlist de
  schemas/relações, bloqueio de múltiplas statements/comentários, LIMIT padrão e
  timeout — antes de qualquer execução.
- **Redação de PII** (e-mail, CPF, CNPJ, telefone) e segredos em logs e respostas
  de erro.
- **Memória**: classificar sensibilidade, expirar, curar; não gravar tudo.

## 4. MCP Gateway (obrigatório)

- Nenhum componente chama um MCP diretamente.
- O Gateway autentica o chamador, autoriza servidor/tool/ação, injeta as
  credenciais do MCP, aplica rate limit/budget, redige dados e audita.
- Habilitar um MCP é decisão de **política**, revisável e reversível.

## 5. Segredos e configuração

- Segredos apenas em `.env`/variáveis do Railway; `.env` está no `.gitignore`.
- `.env.example` nunca contém valores reais.
- Rotação de segredos suportada por configuração (sem redeploy de código).

## 6. Rede e deploy

- Serviços internos (postgres/redis/qdrant) não expostos publicamente em produção
  além do necessário; portas locais são para desenvolvimento.
- TLS na borda; comunicação interna em rede privada.
- Encerramento gracioso (SIGTERM) e healthchecks para orquestração.

## 7. Desenvolvimento assistido por IA

- Claude Code/Codex são ferramentas de **desenvolvimento**, não serviços 24/7.
- Mudanças passam por PR com revisão; nada de credenciais em prompts ou commits.
- Conteúdo externo (issues, comentários, logs, saídas de MCP) é tratado como
  não-confiável (prompt-injection): validar antes de agir.

## 8. Resposta a incidentes (base)

- Logs estruturados e auditáveis por `trace_id`.
- Capacidade de desabilitar rapidamente um MCP, adapter ou capacidade por config.
- Plano de continuidade evolui na fase de escala (ver `ROADMAP.md`).
