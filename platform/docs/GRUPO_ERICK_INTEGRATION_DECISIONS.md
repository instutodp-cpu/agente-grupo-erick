# Decisões de integração do Grupo Erick — 2026-09-29

Status: **direção aprovada pelo proprietário; implementação transversal pendente**. Este registro orienta trabalho novo e não altera os contratos de execução já existentes. Revalidar o estado de cada repositório, app e ambiente antes de cada PR.

## Decisões aprovadas

1. **Maestro e Hermes.** Maestro é o plano de controle de projetos, backlog, aprovações, custos, saúde e decisões. Hermes é o plano de planejamento e execução governada, com identidade, permissões, políticas, auditoria e capacidades. Não criar um segundo orquestrador nos apps.
2. **Donos dos dados.** Linx da Seta, ERP das lojas, permanece a fonte oficial de vendas, produtos, estoque e movimentos que ele registra. Supabase/Postgres é a camada compartilhada governada para dados canônicos próprios, relações entre sistemas, interações e auditoria; dados do Linx sincronizados são projeções com origem e atualização identificadas, não uma segunda fonte oficial. Base44 continua responsável pelos fluxos operacionais próprios de cada app.
3. **Apps existentes.** Integrar gradualmente os apps Base44. Não reconstruir Compras, Insight Hub, CapacitAI, Ponto, Agenda ou ZapCommerce só para obter integração. Preservar fluxos atuais, especialmente WhatsApp, e migrar apenas quando houver motivo comprovado.
4. **Identidade transversal.** Padronizar organização/empresa, loja/unidade, usuário e vínculo/papel antes de compartilhar dados ou capacidades entre apps. Reutilizar contratos de tenant/workspace, permissão e isolamento já presentes em `platform/docs/`; mapear identificadores legados, sem recriar cadastros indiscriminadamente.
5. **Primeira trilha de negócio.** Compras e financeiro primeiro, com leitura e reconciliação; atendimento e vendas depois. A trilha de canário real de `update_file` em staging segue isolada e não autoriza ações financeiras ou acesso real ao Linx.

## Fluxo de dados e fronteiras

- **Linx da Seta → conector/worker → Supabase → API interna de leitura → Hermes.** A direção anterior é não consultar o Linx diretamente pelo Hermes. Confirmar produto/versão Linx, documentação, método de exportação/API, credenciais, frequência, campos, limites e contrato com fornecedor antes de escolher o adaptador.
- O conector deve registrar origem, chave externa, empresa/loja, horário da origem, horário da sincronização, versão/alteração e estado de reconciliação. Definir atualização incremental, deduplicação, atraso tolerável e correção/reprocessamento antes de ingestão real.
- A API interna começa somente leitura, com identidade de tenant/workspace obtida da sessão autenticada, escopo por loja e papel, minimização de dados e auditoria. Não permitir SQL livre, escrita no Linx, pagamento, aprovação, alteração de estoque ou envio de mensagem por consequência de uma consulta.
- **Base44 → contratos por capacidade/evento → Hermes/Supabase.** Cada app conserva suas entidades locais até haver contrato de mapeamento e migração validado. Supabase não vira cópia irrestrita de todos os dados Base44.
- Insight Hub mantém a verdade própria de interações e eventos de provedores conforme sua especificação; Twilio/ElevenLabs são provedores. Identidade de cliente pode ser vinculada às vendas quando houver identificador confiável e política de acesso.
- GitHub é fonte versionada de decisões técnicas, contratos, ADRs e estado verificável. Obsidian pode ser índice e espaço de trabalho humano; não criar uma segunda cópia canônica de contratos ou segredos. Notas devem apontar para o commit/PR e indicar data e status.

## Evitar retrabalho

Antes de abrir qualquer PR: (a) localizar contrato e implementação existente no `main` e PRs abertas; (b) indicar dono do dado e sistema que executa a ação; (c) documentar lacuna comprovada; (d) alterar o menor componente responsável; (e) verificar teste e reversão. Não somar uma nova camada genérica a um contrato que já existe. Contexto antigo não é apagado automaticamente: marcar como histórico/obsoleto com substituto e evidência, depois remover duplicatas apenas em PR específica.

Referências existentes: `platform/docs/INTERNAL_BUSINESS_API_READ_ONLY.md`, `TENANT_WORKSPACE_ISOLATION.md`, `PERMISSION_MATRIX.md`, `CORPORATE_WORKSPACE_CONNECTOR_POLICY.md`, `SECOND_BRAIN_INBOX_CONTRACT.md`, `ROADMAP.md`; `docs/ROADMAP.md` cobre a trilha v1. Estes arquivos podem descrever contratos simulados; esta decisão não os torna conectores ativos.

## Ordem das próximas entregas

1. **Inventário verificável:** repositórios, apps, bancos/ambientes, PRs abertas, fluxos em produção, owner de cada entidade, contrato existente e lacuna. Registrar `observado`, `declarado` ou `não verificado`; separar `main`, staging e produção. Identificar documentos duplicados/obsoletos por links, sem exclusão automática.
2. **Mapa de identidade:** IDs reais de empresa, loja, usuário e papéis em Linx/Base44/Supabase; tabela de correspondência e regras de acesso por unidade; cenários de homônimos e IDs ausentes. Primeiro contrato e testes com fixtures, sem conectar produção.
3. **Linx/Compras leitura:** obter esquema/exportação/API e um conjunto de dados sanitizado; mapear compras, fornecedores/marcas, parcelas, vencimentos, itens e unidades aos contratos existentes. Implementar ingestão incremental em staging com reconciliação; consulta de resumo por loja e consolidado por permissão.
4. **Piloto operacional:** comparar totais e amostras com o Linx, atraso de sincronização, falhas, custo e trilha de auditoria; só depois expor ao Hermes e ao fluxo Base44 de Compras. Escritas e automação financeira exigem decisão e gate próprios.
5. **Próximos domínios:** Insight Hub pós-chamada/custos e atendimento, então vendas/CRM e campanhas; reutilizar identidade e eventos da primeira trilha.

## Pendências factuais, não decisões de arquitetura

- Confirmar variante/produto Linx da Seta, fornecedor/contato técnico e método autorizado de integração.
- Identificar projeto Supabase ativo e dados Linx já sincronizados (histórico anterior cita Railway + Supabase + Metabase; o estado atual requer verificação). Não executar DDL ou ingestão em projeto inativo por suposição.
- Inspecionar Obsidian somente quando houver acesso a um cofre indicado pelo proprietário; até lá, GitHub contém o registro técnico.
- Medir economia de tempo após inventário: horas atuais para resposta/conciliação, volume semanal, retrabalho e custo de manutenção. Não atribuir porcentagem sem linha de base.

## Critério para declarar a primeira integração concluída

Consulta autorizada de Compras por empresa/loja retorna dados reconciliados com o Linx, com origem e frescor visíveis, auditoria, bloqueio de acesso cruzado e fallback claro quando a sincronização falha; o fluxo Base44 atual continua funcionando.
