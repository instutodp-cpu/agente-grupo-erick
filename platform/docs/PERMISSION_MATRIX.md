# Hermes Core Permission Matrix

Matriz oficial de permissões por domínio e capability. Esta etapa existe para
manter o core previsível, seguro e pronto para expandir sem habilitar execução
real.

Estado obrigatório para todos os domínios atuais:

- `can_execute_real_action = false`
- `allowed_adapter_mode = mock`
- `executed:false` continua obrigatório
- qualquer execução real permanece proibida nesta fase

## Matriz atual

| Domain | can_read_context | can_plan | can_request_confirmation | can_run_mock_adapter | can_execute_real_action | requires_confirmation | requires_human_review | allowed_adapter_mode | risk_level |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| compras | true | true | true | true | false | true | true | mock | high |
| financeiro | true | true | true | true | false | true | true | mock | high |
| treinamento | true | true | true | true | false | true | true | mock | medium |
| marketing | true | true | true | true | false | true | true | mock | medium |
| desenvolvimento | true | true | true | true | false | true | true | mock | medium |

## Regras de uso

- `can_read_context` e `can_plan` indicam leitura e planejamento seguro.
- `can_request_confirmation` existe quando o fluxo pode exigir aprovação humana.
- `can_run_mock_adapter` indica apenas simulação local, sem efeito real.
- `can_execute_real_action` permanece `false` até uma PR futura explícita.
- `requires_confirmation` e `requires_human_review` permanecem `true` para os
  domínios atuais.
- `allowed_adapter_mode` fica `mock` em todos os domínios desta fase.
- `risk_level` deve ser revisado antes de adicionar novo domínio.

## Domain Onboarding Preview

Uma PR futura pode introduzir um guia formal para novos domínios. Checklist
mínimo antes de ampliar o core:

- declarar o domínio na matriz
- definir `risk_level`
- definir capabilities
- criar mock adapter
- criar golden scenarios
- adicionar testes
- atualizar smoke/CI se necessário
- manter `executed:false`
- revisar por humano

O processo oficial já foi documentado em `docs/DOMAIN_ONBOARDING.md`; use esse
guia antes de qualquer expansão.

