# C9 — Inventário, compras e reconciliação fiscal

C9 conecta fatos sintéticos de inventário à compra, evidência fiscal e contas a pagar sem transformar estoque de uma fonte em verdade contábil silenciosa.

## Roll-forward

A posição teórica é calculada por:

    saldo inicial
    + compras
    + transferências de entrada
    + devoluções de clientes
    + ajustes positivos
    - vendas
    - transferências de saída
    - devoluções a fornecedor
    - perdas ou danos
    - ajustes negativos

As quantidades usam milésimos inteiros para representar frações sem ponto flutuante. Overflow, tipo desconhecido ou quantidade inválida falha fechado.

## Reconciliação de compra em cinco pontos

A compra só pode ser considerada MATCHED quando todos os pontos estão confirmados:

1. pedido de compra;
2. documento fiscal;
3. recebimento de mercadoria;
4. obrigação a pagar;
5. movimento de inventário.

Qualquer ponto ausente produz NEEDS_REVIEW; nenhum elo é inferido pelo LLM.

## Recebimento e transferências

Recebimento pode ser COMPLETE, PARTIAL, OVER_RECEIVED ou REJECTED. Transferências preservam tenant, empresa, SKU, origem, destino, quantidade expedida e quantidade recebida. Recebimento parcial e excedente permanecem explícitos; origem e destino não podem ser o mesmo estabelecimento.

## Visões de estoque

As três visões permanecem separadas:

- estoque teórico derivado de movimentos;
- contagem física;
- estoque informado pelo ERP.

Diferenças produzem revisão. Não há ajuste automático, write-back ou contabilização.

## Perdas e custo

Uma divergência pode gerar um sinal de integridade/perda, sempre com revisão humana. O sinal não é conclusão de fraude. C9 fornece fatos para CMV, margem, giro, estoque parado, dias de estoque e ruptura futuros; custo contábil autoritativo depende de política versionada própria.

## Fora de escopo

- ajuste automático de estoque;
- write-back em Seta/ERP;
- reclamação autônoma contra fornecedor;
- motor autoritativo de custo;
- persistência, scheduler, rede, segredo ou provedor real.
