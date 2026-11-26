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

## C3.2 — Plano incremental compartilhado e transporte por API (pronto, desligado)

O plano incremental saiu do transporte por arquivo para
`src/hermes/accounting/seta-sync-plan.js` e passou a ser **compartilhado** pelos
dois transportes do mesmo adaptador `seta_read_v1`:

| Transporte | Módulo | Entrada | Estado |
| --- | --- | --- | --- |
| `FILE_EXPORT` | `seta-file-transport.js` | um arquivo exportado do Linx | pronto (C3.1) |
| `API` | `seta-api-transport.js` | **uma página** de registros já buscada pelo conector | pronto, **desligado** até a descoberta |

```text
adapter_id = seta_read_v1
transport = API
mode = READ_ONLY
network = false        # o módulo nunca chama a rede; quem busca a página é o conector
persistence = NONE
fail_closed = true
```

O que fica garantido:

- **Mesmo registro, mesmo manifesto.** Os dois transportes geram os mesmos
  registros canônicos (`seta:<empresa>:<tipo>:<id>`) e as mesmas entradas
  (`sourceId` → `payloadHash`, versão). Uma empresa pode sair do arquivo para a
  API sem reimportar nada: o mesmo registro vira "inalterado"; um valor mudado
  vira nova versão, venha de onde vier. O manifesto guarda também os arquivos
  já vistos (`files`), as páginas já vistas (`apiPages`) e o cursor (`apiCursor`).
- **API fechada até ser descoberta.** `planApiPage` exige
  `assertTransportConfigured` (endpoint oficial, estratégia de autenticação e
  recibo de descoberta `verified` que batem) **e** um mapeamento revisado cujo
  `discovery.layoutSha256` é o hash do conjunto de chaves dos registros. Chave
  nova ou faltando = `SETA_API_LAYOUT_CHANGED`; nada é remapeado por suposição.
- **Mapeamento da API** (`validateApiMapping`): `fields.id`, `fields.occurredAt`,
  `fields.establishment` (e opcional `fields.sourceUpdatedAt`) são chaves JSON;
  `payload` com tipos `text`, `money_brl`, `money_decimal` (`1234.56`),
  `integer` ou `date`; `stores` como no arquivo.
- **Página limitada e idempotente.** Até 1.000 registros e 5 MB; página repetida
  (mesmo `sha256`) vira `IGNORE_DUPLICATE_PAGE`; página vazia só move o cursor;
  rejeições por **posição e motivo**, nunca o conteúdo; evidência
  `api:<sha256 da página>#<posição>`.
- **Isolamento.** Manifesto nunca cruza `tenantId`, `companyId` ou `kind`.

Para ligar a API (passos revisados, fora deste módulo): descoberta oficial da
Seta (endpoint, autenticação, recibo), credencial guardada pelo gateway (nunca
no código), conector que busca uma página por vez pelo MCP Gateway e chama
`planApiPage`, e o mesmo passo revisado de gravação no Supabase do C3.1.
