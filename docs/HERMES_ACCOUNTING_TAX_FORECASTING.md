# C14 — Tributos e previsão tributária

C14 separa previsão, apuração oficial, emissão de guia, pagamento e reconciliação. O escopo é sintético e não chama PGDAS-D, DCTFWeb, MIT, eSocial, EFD-Reinf, FGTS Digital, bancos ou qualquer governo.

Fluxo:

FORECAST → EXPECTED → ASSESSED → GUIDE_ISSUED → PAID → RECONCILED

Uma previsão nunca vira obrigação oficial apenas porque o Hermes a calculou.

## Previsão

A previsão é tenant-scoped e company-scoped, usa competência YYYY-MM estrita, regra versionada e cenários CURRENT, EXPECTED, CONSERVATIVE e STRESS. Valores são centavos inteiros. A camada não fixa tabelas tributárias autoritativas ou alíquotas atuais.

## Fontes e obrigações

As categorias de fonte incluem eSocial, EFD-Reinf, MIT, PGDAS-D, estadual, municipal e outras fontes governadas. A obrigação preserva estado, competência, regra, vencimento, evidências e escopo.

DAE é um documento de arrecadação/cobrança quando aplicável, não um taxType autônomo.

## Reconciliação

O valor previsto é comparado ao valor apurado oficialmente. Qualquer variação acima da tolerância vira TAX_EXCEPTION e exige revisão humana. A camada não altera a origem nem presume que o valor apurado é correto sem evidência.

## Caixa

Obrigações não pagas entram em horizontes determinísticos de 7, 14, 30, 60 e 90 dias. O cálculo exige tenant/company scope, rejeita duplicidades e usa BigInt internamente para evitar soma insegura. Obrigações PAID ou RECONCILED são excluídas.

## Efeitos

Emissão de guia e execução de pagamento exigem estado APPROVED e aprovação humana. O gate retorna apenas autorização lógica; não emite, paga, transmite, persiste externamente ou chama provedor.

## Invariantes

FORECAST != ASSESSED
ASSESSED != PAID
PAID != RECONCILED

## Não implementado

- tabelas atuais autoritativas do Simples ou outros tributos;
- envio PGDAS-D, DCTFWeb, MIT, eSocial, EFD-Reinf ou FGTS Digital;
- emissão real de guia;
- pagamento bancário;
- credenciais, certificados, rede, persistência externa, deploy ou execução autônoma.
