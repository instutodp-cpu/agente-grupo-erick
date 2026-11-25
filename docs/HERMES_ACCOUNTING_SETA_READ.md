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

## C3.1 — Transporte por arquivo (exportação do Linx)

Enquanto não existir API oficial da Seta, a loja pode exportar relatórios do
Linx (CSV ou TSV). O transporte `FILE_EXPORT` (`src/hermes/accounting/seta-file-transport.js`)
é **o mesmo adaptador `seta_read_v1`**, não uma estrutura paralela: cada linha
passa por `normalizeSetaRecord` e cada versão é decidida por `decideSyncAction`.

```text
adapter_id = seta_read_v1
transport = FILE_EXPORT
mode = READ_ONLY
network = false
persistence = NONE
fail_closed = true
```

### Mapeamento revisado por layout e por empresa

Cada relatório do Linx tem um mapeamento JSON, por empresa (`companyId`), com:

- `kind` (chave do `ENTITY_MAP`), `tenantId`, `companyId`, `delimiter`
  (`;`, `,` ou tab) e `dateFormat` (`DD/MM/YYYY` ou `YYYY-MM-DD`);
- `columns.id` (chave externa estável), `columns.occurredAt`,
  `columns.establishment` e, se existir, `columns.sourceUpdatedAt`;
- `stores`: código de loja do Linx → `establishmentId` (loja fora da lista é
  rejeitada, nunca adivinhada);
- `payload`: campos copiados para o registro, com tipo `text`, `money_brl`
  (vira centavos inteiros), `integer` ou `date`;
- `discovery`: `sampleSha256`, `headerSha256`, `verifiedBy`, `verifiedAt`.

Sem `discovery` o transporte falha com `DISCOVERY_REQUIRED`. Se o cabeçalho do
arquivo mudar (hash diferente ou coluna ausente), falha com
`SETA_FILE_LAYOUT_CHANGED`: nenhuma coluna é remapeada por suposição.

### Plano incremental, sem gravação

A saída é um **plano**: registros `CREATE_VERSION` (novos ou alterados, com
versão), contagem de inalterados, rejeições por **linha e motivo** (sem o
conteúdo da linha), proveniência (`sha256` do arquivo, `headerSha256`, nome,
recebimento, empresa, tipo) e o **manifesto seguinte** (`sourceId` →
`payloadHash`, versão). Regras:

- o mesmo arquivo de novo (mesmo `sha256`) vira `IGNORE_DUPLICATE_FILE`;
- payload idêntico vira inalterado; alterado vira nova versão;
- um manifesto nunca cruza `tenantId`, `companyId` ou `kind`;
- cada registro aponta para `file:<sha256>#L<linha>` como evidência.

Gravar o plano no Supabase é um passo separado, revisado, fora deste módulo.
Ele deve reutilizar a cadeia já decidida (Linx → conector → Supabase → leitura
interna → Hermes) e as projeções de `hermes_history`, sem criar um segundo
caminho de leitura para o bot.

### Uso (simulação)

```bash
# 1. Descobrir o layout de um arquivo real e registrar os hashes no mapeamento
node scripts/seta-file-import-plan.js --discover --file vendas.csv --delimiter ';'

# 2. Gerar o plano (grava plan.json e manifest.next.json, modo 0600, sem sobrescrever)
node scripts/seta-file-import-plan.js --file vendas.csv --mapping mapping.json \
  --out ./saida-2026-11-25 [--manifest ./manifest.json]
```

Exemplo de mapeamento (valores ilustrativos; os nomes reais de colunas e lojas
vêm do primeiro arquivo exportado):

```json
{
  "version": 1,
  "kind": "sale",
  "tenantId": "grupo_erick",
  "companyId": "erick_calcados",
  "delimiter": ";",
  "dateFormat": "DD/MM/YYYY",
  "columns": { "id": "Código Venda", "occurredAt": "Data", "establishment": "Loja" },
  "stores": { "001": "calcados_barreiros", "002": "calcados_sirinhaem" },
  "payload": {
    "total_cents": { "column": "Valor Total", "type": "money_brl" },
    "status": { "column": "Situação", "type": "text" }
  },
  "discovery": {
    "sampleSha256": "<saída do --discover>",
    "headerSha256": "<saída do --discover>",
    "verifiedBy": "<pessoa que conferiu>",
    "verifiedAt": "2026-11-25T12:00:00Z"
  }
}
```

Testes: `test/seta-file-transport.test.js`.
