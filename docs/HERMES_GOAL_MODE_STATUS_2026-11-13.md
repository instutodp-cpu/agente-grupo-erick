# Hermes / Maestro GOAL MODE — relatório verificável

Data de consolidação: 2026-11-13

## HEAD e limites

- `main`: `185c8628c649becf53aca969dd7f0dfa9277324e`.
- O relatório consolida apenas evidência pública do repositório, PRs e GitHub Actions.
- Nenhum segredo, dado privado, Supabase real, mudança de permissão, deploy ou novo provider call foi usado nesta consolidação.
- A política permanece simulation-first e fail-closed; Drafts e canários continuam sujeitos à fronteira humana.

## Mudanças aceitas no ciclo

| PR | Escopo | Resultado |
| --- | --- | --- |
| #563 | origem simulada A3 e proveniência independente | mesclado; pós-merge CI verde |
| #564 | Segundo Cérebro com isolamento e ingestão bloqueada por padrão | mesclado; pós-merge CI verde |
| #565 | Outlook via Composio, metadados somente leitura | mesclado; pós-merge CI verde |
| #566 | consistência do analista Telegram | mesclado; pós-merge CI #2064 verde |
| #567 | reautenticação operacional ligada ao operador confiável | mesclado; pós-merge CI #2070 verde |
| #568 | contrato exato de segredo para canário de staging | mesclado; pós-merge run #43452889177 verde |
| #569 | fundação Legal reconstruída no `main` atual | mesclado em `185c8628`; pós-merge run #43464011631 verde |

## Evidência atual em revisão

- [#570](https://github.com/instutodp-cpu/agente-grupo-erick/pull/570): relatório do canário A2; CI verde, mantido Draft na fronteira de merge humano.
- [#571](https://github.com/instutodp-cpu/agente-grupo-erick/pull/571): aceitação histórica de `create_pull_request` em staging; CI Hermes 24/24 verde, mantido Draft.
- [#572](https://github.com/instutodp-cpu/agente-grupo-erick/pull/572): decisões transversais de governança; CI Hermes 24/24 verde, mantido Draft.

## PRs históricas supersedidas

- #453 foi substituído pelo #571.
- #400 foi substituído pelo #572.
- #250 foi substituído pelo #568.
- #531 foi substituído pelo #569.
- #530 foi substituído pelo #570.
- #544 e #543 foram substituídos pelo #567.
- #146, #118 e #19 foram revisados como snapshots antigos sem falha atual comprovada; não foram copiados.
- O PR #510 de Accounting permanece separado para reconstrução dedicada no `main` vigente.

## Conclusão operacional

Telegram, Segundo Cérebro, Outlook simulado, reautenticação, contrato de staging e fundação Legal têm evidência de CI e revisão no estado atual. O próximo avanço que exige decisão do proprietário é administrativo: tornar os Drafts apropriados prontos para revisão/merge. Até essa decisão, não há autorização para merge autônomo, deploy, integração real ou execução financeira.
