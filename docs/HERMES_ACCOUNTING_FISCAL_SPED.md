# C12 — Validação fiscal e pré-SPED

C12 estabelece uma camada de validação fiscal antes de qualquer submissão. O escopo é sintético, somente leitura/análise/preparação e sem chamada a SEFAZ, SPED, PVA, governo, banco ou sistema externo.

Fluxo:

SETА + documentos fiscais + inventário + contas a pagar + diário
→ validação fiscal
→ exceções
→ pacote pré-SPED
→ revisão humana/contábil
→ submissão futura, somente com integração autorizada

## Validade documental não é correção tributária

Um documento pode estar formalmente válido e ainda ter classificação fiscal incompleta ou incorreta. A validação exige os campos declarados pelo contrato, como CFOP, NCM, CEST, CST/CSOSN, origem e tributos aplicáveis.

Classificação atribuída por IA ou LLM nunca vira VALIDATED automaticamente; o resultado é BLOCKED e exige revisão.

## Regras versionadas

Toda validação deve apontar para uma regra oficial versionada com autoridade, fonte, hash de esquema e janela efetiva. Datas inválidas, regra expirada ou regra ainda não vigente bloqueiam o resultado.

## Cruzamentos

Os quatro cruzamentos precisam ser explicitamente verdadeiros:

- fiscal com compras;
- fiscal com inventário;
- fiscal com contas a pagar;
- fiscal com diário.

Ausência ou falsidade de qualquer cruzamento resulta em NEEDS_REVIEW. Não há matching fuzzy nem inferência silenciosa.

## Competência e prontidão

Obrigações são tenant-scoped, company-scoped e usam competência estrita YYYY-MM. A prontidão exige esquema, regras de negócio, cruzamentos e evidências completos. O pacote pré-SPED pronto continua READY_FOR_REVIEW; ele não é uma autorização de envio.

## Estados de submissão

SUBMITTED não significa ACCEPTED. REJECTED preserva o código de rejeição. O resultado é marcado como simulationOnly e não produz efeito externo.

A função de autorização exige simultaneamente estado APPROVED e aprovação humana. Mesmo quando retorna sucesso, ela apenas prova o gate; não realiza submissão.

## Não implementado

- execução SPED/PVA ou transmissão governamental;
- credenciais, certificados ou segredos;
- classificação tributária autoritativa do Grupo Erick;
- correção automática em fonte de origem;
- postagem, pagamento, persistência externa ou deploy.
