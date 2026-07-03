# Semantic Cache — cache semântico do Hermes

## O que é

O **Semantic Cache** é o caminho nº 2 da cascata da HIL (logo após a Response
Library). Seu objetivo é **reutilizar respostas equivalentes mesmo quando o
texto da pergunta muda**:

> "Qual foi o faturamento de cada loja em junho de 2026?"
> ≈ "quanto cada loja faturou em junho/2026?"

Ambas querem a mesma coisa. Sem cache semântico, cada variação de texto vira uma
pergunta "nova" e paga SQL/IA de novo. Com ele, respostas equivalentes são
reaproveitadas — reduzindo custo e latência, no espírito da HIL (reduzir o uso
de IA).

## Esta PR é só a fundação

Nada está integrado e o comportamento atual não muda:

- **Não** integra ao `/api/chat`.
- **Não** usa embeddings ainda (a chave é léxica nesta fase).
- **Não** chama o Claude.
- `findSemanticCacheEntry()` e `saveSemanticCacheEntry()` são **no-ops**
  (retornam `null` e `false`).
- O cache exato atual (`src/hermes/cache.js`) permanece intacto.

## Como a chave semântica funciona (fundação léxica)

`buildSemanticKey(classification, parameters)` gera um hash estável:

- **Intenção conhecida** → agrupa por `intent + parâmetros`. Todas as formas de
  perguntar a mesma coisa (mesma intenção e mesmos parâmetros) colidem na mesma
  chave, independentemente do texto exato.
- **Intenção desconhecida** → usa os **tokens canônicos** da pergunta
  (`canonicalTokenSignature`): normaliza (minúsculas, sem acento, sem
  pontuação), remove stopwords em PT-BR e ordena os tokens únicos. Assim,
  reordenar palavras ou adicionar palavras de ligação não muda a chave.

`normalizeSemanticQuestion(question)` faz a normalização base do texto.
Parâmetros usam uma assinatura estável (independe da ordem das chaves), então
`{mes:6, ano:2026}` e `{ano:2026, mes:6}` geram a mesma chave.

> A chave léxica é uma aproximação. A fase seguinte adiciona **embeddings**
> (coluna `embedding` + pgvector) para capturar equivalência de significado além
> do léxico, complementando ou substituindo a chave atual.

## Módulo e tabela

- Módulo: `src/hermes/intelligence/semantic-cache.js`.
- Tabela documentada: `docs/sql/SEMANTIC_CACHE.sql` (**não aplicada
  automaticamente**). A coluna `embedding` fica preparada (comentada) até o
  pgvector ser habilitado.

## Interfaces

| Função                                   | Hoje (fundação)                    |
| ---------------------------------------- | ---------------------------------- |
| `normalizeSemanticQuestion(question)`    | Normaliza o texto.                 |
| `canonicalTokenSignature(question)`      | Tokens canônicos ordenados.        |
| `buildSemanticKey(classification, params)` | Hash estável da chave semântica. |
| `findSemanticCacheEntry(query)`          | no-op → `null` (miss).             |
| `saveSemanticCacheEntry(entry)`          | no-op → `false`.                   |

## Próximos passos

1. Persistir e ler o cache semântico (implementar find/save de fato).
2. Adicionar embeddings + busca por similaridade (pgvector).
3. Integrar como caminho nº 2 da cascata da HIL no `/api/chat`, com telemetria
   de hit/miss e economia de custo/latência.
