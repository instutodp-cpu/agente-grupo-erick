# Hermes AI Platform v2 — Blueprint

> Documento **fonte da verdade** da arquitetura. Toda decisão de design deve ser
> consistente com este blueprint. Mudanças arquiteturais passam por PR que
> atualiza este arquivo.

## 1. Visão

Hermes é o **orquestrador principal** de um ecossistema de IA para negócios,
apps internos, automações, dados, WhatsApp, Base44, Supabase, GitHub, Claude
Code e MCPs. Hermes **não é um chatbot** — é uma camada de orquestração,
governança e memória sobre dados, processos e ferramentas.

Princípio central:

> **IA é camada de orquestração e raciocínio, não a fonte da verdade.**
> A verdade vive em bancos, sistemas de domínio, métricas oficiais, templates,
> eventos, documentos curados e políticas versionadas.

## 2. Decisões arquiteturais (invariantes)

Estas decisões são **invariantes**: código e novos módulos devem respeitá-las.

1. **Hermes é o núcleo/orquestrador principal.** Todo tráfego passa pelo core.
2. **MaxClaw / OpenClaw NÃO são o núcleo.** São agentes/runtimes **substituíveis**
   por trás de uma interface. O core nunca depende de um runtime específico.
3. **Nenhuma ferramenta específica fica acoplada ao núcleo.** Supabase, Redis,
   Qdrant, MCPs, provedores de modelo — todos entram por **adaptadores** atrás de
   interfaces (Ports & Adapters / Hexagonal).
4. **MCP só via Gateway com policy layer.** Nunca chamar um MCP diretamente sem
   passar pelo MCP Gateway (autenticação, autorização, rate limit, auditoria).
5. **Docker para dev local; Railway para o primeiro deploy 24/7.**
6. **Supabase/Postgres** é a fonte transacional. **Redis** para fila/cache/
   sessões. **Qdrant** para RAG/memória vetorial.
7. **Claude Code / Codex são agentes de desenvolvimento**, não serviços 24/7.
8. **Desacoplamento e reversibilidade.** Tudo é substituível sem retrabalho do
   core.

## 3. Camadas

```text
Canais
  Web | WhatsApp | Base44 Apps | API externa | GitHub | CLIs

Hermes Core (orquestrador)
  Ingress/BFF | AuthN/AuthZ | Policy Engine | Intent Router | Capability Resolver
  Agent Runtime (pluggable) | Memory Manager | MCP Gateway (client) | Audit

Agentes especialistas (pluggables)
  Financeiro | Compras | RH | Marketing | Diretoria | Auditoria | Dev(Code)

Adaptadores (Ports & Adapters)
  Postgres/Supabase | Redis | Qdrant | MCP Gateway | Provedores de modelo | Base44

Infraestrutura
  Docker (local) | Railway (deploy) | Observabilidade | Segredos
```

O núcleo conhece **interfaces (ports)**; a infraestrutura fornece
**implementações (adapters)**. Trocar Qdrant por outro vetor DB, ou Redis por
outra fila, é trocar um adapter — o core não muda.

## 4. Hermes Core (componentes)

### 4.1 Ingress / BFF
Recebe tráfego dos canais, normaliza mensagens, cria `request_id`/`trace_id`,
aplica rate limit e encaminha para o pipeline de orquestração.

### 4.2 AuthN / AuthZ + Policy Engine
Autentica o usuário/serviço e autoriza por **papel, departamento, loja, dado e
ação**. O Policy Engine decide o que pode ser executado, por quem, com quais
dados e se exige **aprovação humana**.

### 4.3 Intent Router
Classifica a intenção da mensagem (barato/determinístico primeiro) para escolher
o caminho mais eficiente antes de acionar qualquer agente caro.

### 4.4 Capability Resolver
Descobre **qual capacidade** (registro central de capacidades) atende a
intenção, com metadados de `domain`, `status`, `permissions`, `riskLevel` e
`requiresApproval`. Resolver ≠ executar.

### 4.5 Agent Runtime (pluggable)
Executa a capacidade escolhida. Runtimes de agente (ex.: MaxClaw/OpenClaw, SDKs
de modelo) implementam uma **interface comum** e são intercambiáveis. O core
nunca importa um runtime diretamente — usa a porta `AgentRuntime`.

### 4.6 Memory Manager
Gerencia memória de curto prazo (sessão, via Redis) e de longo prazo (semântica,
via Qdrant), com classificação de sensibilidade, expiração e curadoria. Ver §7.

### 4.7 MCP Gateway (cliente)
Único caminho para MCPs. Aplica policy, credenciais, rate limit e auditoria. Ver
§6.

### 4.8 Audit
Registra interações, decisões, tool calls, SQL e acessos — com `trace_id` e sem
vazar segredos/PII em claro.

## 5. Agentes especialistas

Agentes de domínio (Financeiro, Compras, RH, Marketing, Diretoria, Auditoria,
Dev) são **pluggables**: registram capacidades no registry, declaram permissões e
nível de risco, e são executados pelo Agent Runtime sob o Policy Engine. Cada um
tem ferramentas, permissões e métricas próprias — sem acesso direto à
infraestrutura fora dos adaptadores.

O **agente de desenvolvimento** (Claude Code/Codex) é usado para construir o
sistema, **não** roda como serviço 24/7.

## 6. MCP Gateway (policy layer)

Regra dura: **nenhum componente chama um MCP diretamente.** O MCP Gateway:

- Autentica quem chama e autoriza a ação/servidor/tool.
- Injeta credenciais do MCP (o agente nunca as vê).
- Aplica rate limit e budgets.
- Redige dados sensíveis e audita cada chamada.
- Permite habilitar/desabilitar servidores/tools por política.

Assim, adicionar um MCP novo é uma decisão de **política**, não de código do core.

## 7. Memória

- **Curto prazo (sessão):** Redis. Contexto da conversa, estado efêmero, TTL.
- **Longo prazo (semântica):** Qdrant. Embeddings de documentos curados,
  preferências e memórias aprovadas; busca por similaridade para RAG.
- **Transacional:** Postgres/Supabase. Verdade de negócio, auditoria, catálogos.

Princípios: não gravar tudo automaticamente; classificar sensibilidade; expirar;
permitir revisão/curadoria; contexto mínimo necessário.

## 8. Permissões

Autorização em múltiplas dimensões: **papel, departamento, loja, dado, ação**.
Capacidades declaram `permissions`, `riskLevel` e `requiresApproval`. Ações
sensíveis exigem **human-in-the-loop**. Segredos ficam fora do alcance dos
agentes (injetados por gateways/adapters). Ver `SECURITY.md`.

## 9. Deploy

- **Local:** `docker compose up` (api, worker, redis, postgres, qdrant).
- **Produção (primeiro 24/7):** Railway — `api` e `worker` como serviços;
  Postgres via Supabase; Redis e Qdrant como serviços gerenciados/containers.
- **Config por ambiente** via variáveis; segredos nunca no repositório.
- **Claude Code/Codex**: ferramentas de desenvolvimento (CI/PRs), não runtime.

## 10. Roadmap (resumo)

Ver `ROADMAP.md`. Em alto nível: fundação desacoplada → Policy/Auth → Capability
Registry/Resolver/Executor → Memória (Redis/Qdrant) → MCP Gateway → agentes
especialistas → canais (WhatsApp/Base44) → escala.

## 11. O que NÃO fazer

- Acoplar o core a um runtime, DB, fila, vetor ou MCP específico.
- Chamar MCP fora do Gateway.
- Colocar segredos no código ou logs.
- Rodar Claude Code/Codex como serviço 24/7.
- Implementar complexidade antes da fundação estar desacoplada.
