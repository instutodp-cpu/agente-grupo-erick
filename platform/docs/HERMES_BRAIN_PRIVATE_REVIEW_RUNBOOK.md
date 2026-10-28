# Hermes Brain — revisão humana privada (staging, PR #564)

## Estado verificado antes desta entrega
Há uma proposta real pendente com título **Primeiro teste real do Hermes Brain**,
tenant `grupo_erick`, domínio `projetos`, classificação `internal` e fonte `user_note`.
Nenhuma aprovação foi autorizada com o comando "Vamos seguir".

## Contrato de segurança
- Aplicar somente o DDL `042_create_second_brain_private_review.sql` no projeto
  Supabase canônico `hermes-brain` **após CI verde**. A migração não aprova, rejeita
  ou modifica nenhuma proposta existente.
- Revisão privada `hermes_brain.review_proposal`: `SECURITY INVOKER`,
  somente console SQL privilegiado `postgres`. Sem privilégio `EXECUTE`
  para `anon`, `authenticated` ou `service_role`.
- Não existe botão de aprovação no navegador, Telegram ou em RPC pública.
- Aprovação exige instrução humana separada e inequívoca para a proposta
  identificada, uma referência humana `HUMAN-...`, reviewer e SHA-256 exato do
  corpo revisado, status `pending`, associação ativa ao tenant, e escopo
  `projetos/internal/owner_only` (reutiliza os escopos existentes).
- Registra evento de decisão único por proposta. `reject` não cria source/memory.
  `approve` cria source verificada e memory aprovada por 30 dias, visível
  exclusivamente ao autor via RLS. Tudo no mesmo COMMIT.
- Não armazenar tokens, credenciais administrativas, transcrições externas,
  segredos nem snapshots privados em Git ou em evidências de revisão.

## Revisão SEM mutação no console SQL administrativo
A consulta abaixo somente apresenta a proposta exata e um hash para aprovação:
```sql
SELECT tenant_id,proposal_id,title,body,domain,classification,
       source_type,source_ref,status,actor_user_id,submitted_at,
       encode(sha256(convert_to(body,'UTF8')),'hex') AS reviewed_body_sha256
FROM hermes_brain.inbox_candidates
WHERE tenant_id = 'grupo_erick'
  AND proposal_id = '<UUID_DA_PROPOSTA>'::uuid
  AND status = 'pending';
```
Rever o conteúdo, autoria, consentimento e validade da fonte antes de pedir
aprovação humana explícita. Não executar o procedimento de decisão só por
ele estar documentado.

## Operação futura SOMENTE após aprovação expressa
Use o mesmo SHA do SELECT acima e uma referência de aprovação inequívoca.
O UUID do revisor deve corresponder a um membro humano ativo no mesmo tenant.
```sql
SELECT hermes_brain.review_proposal(
  'grupo_erick',
  '<UUID_DA_PROPOSTA>'::uuid,
  '<UUID_DO_REVISOR>'::uuid,
  'approve',
  '<SHA256_DO_CORPO_REVISADO>',
  'HUMAN-APROVACAO-IDENTIFICADA',
  'Revisão humana específica e registrada para o item de teste.'
);
```
Se houver reprovação, substitua `approve` por `reject` após autorização específica.
Não faça o mesmo pedido duas vezes. O banco rejeita propostas fora do status pendente.

## Verificação pós decisão (quando houver)
Verificar ledger, mudança de status da inbox e, em caso de aprovação,
source verificada + memória aprovada. Validar busca sob JWT real do autor,
403/401 em anônimo, tenant diferente, autor diferente, status revogado e
conteúdo expirado. **Não afirmar busca E2E antes do teste autenticado.**
Produção permanece bloqueada e nenhum merge ocorre automaticamente.
