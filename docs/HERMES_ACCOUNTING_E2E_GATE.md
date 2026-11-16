# Hermes Accounting C0–C18 E2E gate

Este gate cruza os contratos contábeis atuais em um fluxo sintético, sem provedor,
segredo, rede, persistência externa ou efeito operacional.

## Caminho feliz

`fato canônico + evidência`
→ `reconciliação determinística`
→ `diário balanceado`
→ `aprovação humana para postagem`
→ `fechamento pronto e pacote imutável`
→ `auditoria interna independente`
→ `handoff ao contador`

O handoff nasce em `DRAFT`; a prontidão calculada permite somente a transição
explícita para `READY_FOR_ACCOUNTANT`. Uma alteração posterior exige solicitação,
evidência, aprovação humana e nova versão, sem sobrescrever o alvo anterior.

## Caminho adversarial

O teste também comprova que:

- submissão fiscal sem aprovação falha fechada;
- execução de pagamento sem aprovação é negada;
- ocultação de documento sem evidência exige revisão;
- lançamento artificial para “fazer fechar” é negado;
- auditoria com exceção crítica mantém o handoff em `DRAFT`.

## Significado

CI verde prova apenas que os contratos C0–C18 compõem coerentemente em teste.
Não representa prontidão de produção, autorização de integração, período shadow,
persistência transacional ou autoridade de merge. O PR permanece Draft até revisão
independente e promoção humana explícita.
