# C13 — Folha, comissões e provisões trabalhistas

C13 conecta contratos de trabalho, fatos de jornada e fatos de vendas a uma preparação determinística de folha. O escopo é sintético, sem eSocial, FGTS Digital, pagamento bancário, sanção disciplinar ou efeito no RH.

Fluxo:

EMPREGADO → contrato / função / estabelecimento
→ jornada + vendas + eventos de RH
→ regras versionadas
→ cálculo determinístico em centavos inteiros
→ prévia de folha
→ revisão humana
→ folha oficial futura

## Escopo e fatos

Contrato, empregado, tenant, empresa e estabelecimento permanecem explícitos. Datas de vigência e competência são estritas. Eventos de salário, comissão, hora extra, ausência, DSR, férias, décimo terceiro, benefícios, encargos, adiantamentos, descontos, desligamento e pró-labore não são colapsados em um único valor.

## Comissões

Planos de comissão são versionados e limitados a basis points inteiros. Vendas elegíveis usam aritmética inteira com arredondamento determinístico; o cálculo rejeita plano de outra empresa/tenant ou fora da vigência.

A reconciliação compara a comissão esperada com a folha. Até uma diferença de um centavo vira PAYROLL_EXCEPTION e exige revisão humana.

## Integridade de vendas

Sinais de reatribuição de vendas perto de metas são sinais de integridade. Eles preservam evidências e exigem revisão, mas nunca concluem fraude, perda de comissão ou punição disciplinar.

## Provisões

Férias, adicional de férias, décimo terceiro, FGTS e INSS permanecem com valueState PROVISION até uma etapa autorizada posterior. O C13 não transforma provisão em pagamento ou obrigação oficial.

## Prontidão e prévia

A prévia exige contrato, jornada, vendas, regras efetivas, evidências e cálculo determinístico. A saída READY_FOR_REVIEW é uma prévia imutável, marcada simulationOnly e com paymentEffect NONE.

## Efeitos de alto risco

Desligamento exige estado APPROVED e aprovação humana. O gate apenas retorna autorização lógica; não executa desligamento, pagamento, sanção ou chamada externa.

## Não implementado

- tabelas trabalhistas autoritativas;
- eSocial, FGTS Digital ou qualquer transmissão oficial;
- cálculo legal autônomo a partir de texto de LLM;
- pagamento bancário;
- punição, perda automática de comissão ou alteração de cadastro de empregado;
- persistência externa, deploy ou integração com RH.
