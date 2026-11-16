# C11 — Preparação de diário e subledger contábil

C11 converte fatos reconciliados em rascunhos de diário auditáveis:

    FATOS VERIFICADOS
    → REGRA CONTÁBIL VERSIONADA
    → RASCUNHO DE DIÁRIO
    → BALANCEAMENTO DETERMINÍSTICO
    → REVISÃO HUMANA
    → APROVAÇÃO
    → POSTAGEM futura

## Partida dobrada

Cada entrada deve satisfazer exatamente, em centavos inteiros:

    soma dos débitos = soma dos créditos

Diferença de um centavo, soma insegura, linha zero, linha duplicada ou conta ausente bloqueia a entrada. O código não cria suspense ou linha de ajuste apenas para fazer o diário fechar.

## Escopo e dimensões

A entrada preserva tenant, empresa, estabelecimento, competência, fatos de origem, evidências, regra e versão do plano de contas. Linhas podem carregar centro de custo e departamento; se informarem empresa ou estabelecimento incompatível com a entrada, falham fechadas.

## Plano e classificação

O plano de contas precisa vir de uma fonte aprovada e versionada. O LLM não inventa o plano autoritativo. Classificação sugerida sem mapeamento aprovado permanece NEEDS_REVIEW.

## Estado econômico

ACTUAL, FORECAST, PROVISION, ASSESSED e PAID continuam distintos. C11 não transforma previsão, provisão ou avaliação em fato pago.

## Autoridade

C11 prepara e valida. Aprovação humana é necessária para uma proposta de postagem, mas este contrato não posta, não escreve em ERP, não cria lançamento persistente e não executa integração.

## Fora de escopo

- conector ou postagem em ERP/contabilidade;
- plano de contas autoritativo do Grupo Erick;
- limpeza automática de suspense;
- persistência de ledger;
- chamada de LLM para calcular valores;
- rede, segredo, scheduler ou efeito financeiro.
