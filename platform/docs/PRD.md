# Hermes AI Platform v2 — PRD (Product Requirements)

## 1. Problema

Negócios internos precisam de respostas e ações confiáveis sobre dados e
processos, em múltiplos canais, sem depender de conhecimento tribal nem de
consultas manuais. Ferramentas de IA soltas geram custo, risco e inconsistência.

## 2. Objetivo do produto

Uma plataforma **orquestradora** (Hermes) que entende pedidos, escolhe o caminho
mais barato e seguro para respondê-los, executa capacidades governadas e mantém
memória e auditoria — de forma **desacoplada** e **evolutiva**.

## 3. Público / usuários

- **Diretoria e gestores**: relatórios, decisões, panoramas.
- **Áreas operacionais** (Financeiro, Compras, RH, Marketing): consultas e ações
  do dia a dia.
- **Desenvolvedores**: constroem capacidades e integrações (via Claude Code/Codex).
- **Sistemas/Apps** (Base44, automações): consomem capacidades via API.

## 4. Escopo desta etapa (fundação)

Incluído:
- Estrutura de repositório desacoplada e documentação fonte da verdade.
- `docker compose up` com `api`, `worker`, `redis`, `postgres`, `qdrant`.
- Núcleo mínimo (health/readiness), sem acoplar ferramentas.

Fora de escopo agora:
- Agentes especialistas completos, WhatsApp, RAG real, execução de MCP.
- Qualquer funcionalidade complexa antes da fundação estar sólida.

## 5. Requisitos funcionais (visão)

- **RF1** Ingress multicanal com `trace_id` por interação.
- **RF2** AuthN/AuthZ e Policy Engine (papel, departamento, loja, dado, ação).
- **RF3** Intent Router + Capability Resolver + Registry de capacidades.
- **RF4** Agent Runtime pluggable (runtimes substituíveis).
- **RF5** Memória: sessão (Redis), semântica (Qdrant), transacional (Postgres).
- **RF6** MCP **somente** via Gateway com policy/auditoria.
- **RF7** Auditoria de interações, decisões, tool calls e SQL.

## 6. Requisitos não-funcionais

- **RNF1 Desacoplamento**: nenhuma ferramenta específica acoplada ao core.
- **RNF2 Reversibilidade**: trocar DB/fila/vetor/MCP = trocar adapter.
- **RNF3 Segurança**: segredos fora de código/logs; PII redigida; least privilege.
- **RNF4 Observabilidade**: logs estruturados, métricas, custos.
- **RNF5 Custo/latência**: caminhos determinísticos e cache antes de LLM.
- **RNF6 Operabilidade**: sobe local com um comando; deploy simples no Railway.

## 7. Métricas de sucesso

- Fundação sobe local com `docker compose up` sem edição manual.
- Novos módulos/adaptadores entram sem alterar o core.
- % de pedidos resolvidos por caminhos baratos (sem LLM) cresce ao longo do tempo.
- Toda ação sensível tem trilha de auditoria e respeita políticas.

## 8. Riscos e mitigações

- **Acoplamento acidental** → interfaces/adapters + revisão arquitetural em PR.
- **Vazamento de segredos** → gateways injetam credenciais; redaction; SECURITY.md.
- **Complexidade prematura** → roadmap incremental; fundação primeiro.
- **Dependência de runtime** (MaxClaw/OpenClaw) → porta `AgentRuntime` estável.

## 9. Marcos

Ver `ROADMAP.md`.
