# Hermes Accounting — captura bancária e Pix C5 (simulada)

## Escopo

C5 define uma fronteira sintética de leitura para fatos bancários e Pix. O gateway de leitura é independente de qualquer futuro gateway de pagamentos e não possui efeito monetário.

Permitido neste contrato:

- leitura de saldo;
- leitura de transações;
- leitura de Pix;
- preservação de referência, escopo e evidência para reconciliação futura.

Bloqueado neste contrato:

- preparar ou executar pagamento;
- enviar ou estornar Pix;
- alterar saldo;
- expor credenciais ao modelo;
- reconciliar automaticamente ou persistir fora dos testes.

## Fatos canônicos

Transações preservam tenant, empresa, conta, data de lançamento, direção, valor inteiro em centavos, saldo opcional, tipo, contraparte, referência bancária, descrição e evidências. A identidade sintética usa conta, referência, data, direção e valor; o identificador técnico do registro não altera a deduplicação.

Pix exige pelo menos um identificador forte — `endToEndId` ou `txid` — e a comparação respeita tenant, empresa e conta bancária antes de considerar a identidade. Valores fracionários, negativos, inseguros ou datas inválidas falham fechados.

## Transportes previstos

A ordem declarativa é:

1. API oficial do banco;
2. Open Finance/API autorizado;
3. OFX;
4. CNAB ou arquivo estruturado;
5. ingestão manual controlada.

Browser scraping não é transporte preferencial. OAuth, mTLS e demais segredos devem permanecer em um broker de credenciais; nunca entram em prompt ou contexto do modelo. Webhook sem assinatura verificada é rejeitado.

## Limites

Este C5 não acessa banco, Open Finance, OFX, CNAB, webhook real ou credencial. Também não executa pagamento, Pix, estorno, reconciliação, scheduler, persistência ou contabilização. A próxima camada de reconciliação deve ser um contrato separado e continuar somente sintética.
