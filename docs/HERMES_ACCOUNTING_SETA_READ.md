# C3 — Seta Read Adapter Foundation

C3 define a fronteira entre fatos Seta/Linx e o modelo canônico Accounting do Hermes.

## Postura de segurança

O adaptador é estritamente somente leitura:

```text
adapter_id = seta_read_v1
mode = READ_ONLY
create/update/delete/execute = false
direct_db_write = false
source_of_truth = SETA
local_copy = EVIDENCE_CACHE
fail_closed = true
audit_required = true
transport_status = DISCOVERY_REQUIRED
```

Nenhum endpoint oficial ou contrato de autenticação do Grupo Erick é presumido. Até existir uma prova de descoberta oficial, a configuração de transporte falha com `DISCOVERY_REQUIRED`. A função de validação não faz chamada de rede.

## Normalização

Lojas, vendas, compras, recebíveis, contas a pagar, movimentos de estoque, recebimentos de mercadoria, referências fiscais, pagamentos e contrapartes são mapeados para entidades C1. Tipos desconhecidos falham fechados.

Cada fato normalizado preserva referência da fonte, timestamp de atualização, dimensões de empresa/loja, hash determinístico do payload e referências de evidência. A operação sempre produz autoridade `READ`.

## Sincronização

Payload idêntico e hash idêntico são ignorados de forma idempotente. Payload alterado cria nova versão; não sobrescreve silenciosamente o histórico.

## Fora de escopo

- credenciais, endpoint de produção ou chamada externa;
- polling, webhook ou persistência;
- escrita em Seta/Linx;
- exposição em chat/runtime;
- migração ou alteração de permissões.
