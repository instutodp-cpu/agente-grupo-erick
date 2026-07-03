# PROJECT_PRINCIPLES.md

Princípios oficiais do projeto Hermes.

## 1. Segurança primeiro

Nenhuma funcionalidade justifica expor dados indevidamente. Autenticação, autorização, mascaramento e auditoria são requisitos de produto, não detalhes técnicos.

## 2. SQL Templates antes de IA

Perguntas recorrentes e métricas oficiais devem usar SQL Templates versionados, testados e parametrizados. SQL livre gerado por IA deve ser exceção controlada.

## 3. Cache antes de IA

Se uma resposta segura e atualizada já existe em cache, o Hermes deve reutilizá-la. IA não deve ser chamada por hábito.

## 4. IA só quando necessário

Classificação simples, templates, relatórios pré-calculados e regras determinísticas devem vir antes de modelos caros.

## 5. Observabilidade obrigatória

Toda execução deve ter rastreabilidade: usuário, canal, intenção, modelo, prompt version, tool calls, SQL, latência, custo e resultado.

## 6. Auditoria contínua

Toda ação relevante deve ser auditável. Logs devem permitir responder: quem pediu, o que foi consultado, qual ferramenta executou, qual dado retornou e qual resposta foi enviada.

## 7. Memória limpa

Memória não é dump de conversa. Memória deve ser explícita, útil, classificável, revisável e removível.

## 8. Contexto mínimo

O Hermes deve enviar ao modelo apenas o contexto necessário. Contexto demais aumenta custo, latência e risco de vazamento.

## 9. Modularidade

Canais, agentes, ferramentas, domínios e infraestrutura devem evoluir de forma independente.

## 10. Nenhuma regra de negócio duplicada

Métricas e regras devem ter dono e fonte única. O mesmo conceito não deve existir de formas diferentes em prompt, SQL, dashboard e código.

## 11. Fonte da verdade fora do modelo

Modelos podem interpretar, resumir e orientar, mas não são fonte da verdade. Dados oficiais vêm de bancos, documentos curados, sistemas de domínio e métricas versionadas.

## 12. Human-in-the-loop para ações sensíveis

Ações com impacto financeiro, reputacional, jurídico, operacional ou sobre dados sensíveis exigem aprovação humana ou política explícita.

## 13. Versionamento de tudo que muda comportamento

Prompts, templates SQL, políticas, tools, agentes e memórias corporativas devem ser versionados.

## 14. Pequenas Pull Requests

Evolução deve ocorrer em passos pequenos, testáveis e reversíveis. Grandes reescritas sem valor incremental devem ser evitadas.

## 15. Domínio antes de framework

LangGraph, Agents SDK, CrewAI, Mastra, Mem0, Graphiti e MCP são referências e ferramentas possíveis. A arquitetura deve atender ao domínio do Grupo Erick, não ao hype de framework.

## 16. Custo é requisito de arquitetura

Toda decisão de modelo, cache, contexto e consulta deve considerar custo operacional.

## 17. Respostas com período e fonte

Quando responder com dados, Hermes deve informar período consultado e, sempre que possível, origem/consulta/template usado.

## 18. Escalonamento é funcionalidade nativa

Quando o Hermes não souber, não puder ou detectar risco, deve escalar para humano ou fluxo especializado.

## 19. Integrações por contrato

Supabase, Metabase, Evolution API, n8n, WhatsApp e Base44 devem ser integrados por contratos claros, não por acoplamento espalhado.

## 20. Aprendizado contínuo com governança

Feedback e avaliação devem melhorar o sistema, mas mudanças automáticas em comportamento crítico exigem revisão, métricas e rollback.
