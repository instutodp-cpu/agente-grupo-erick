# C16 — Inteligência contábil e análise gerencial

C16 transforma fatos contábeis verificados em métricas e sinais gerenciais explicáveis. O escopo é sintético; não cria verdade financeira por narrativa de LLM, não persiste em warehouse e não executa ação gerencial.

## Visões

ACTUAL, FORECAST e FINAL são visões explícitas. Métricas de visões diferentes não podem ser misturadas silenciosamente.

## Escopo

Métricas, DRE, anomalias e CFO Brief carregam tenant e empresa. A DRE também carrega tipo e identificador de escopo, como loja, centro de custo ou grupo.

## Metadados de afirmação material

Toda afirmação financeira material exige:

- período;
- visão;
- atualização dos dados;
- cobertura;
- status de reconciliação;
- IDs e quantidade de evidências.

Sem evidência, a afirmação é rejeitada.

## Drivers

A decomposição compara período atual e anterior, soma drivers com aritmética segura e deixa explícito o restante não explicado. Nenhuma narrativa preenche o residual.

## Anomalias

Detectores determinísticos ou estatísticos produzem sinais para revisão humana. Um sinal nunca conclui fraude nem gera punição.

## CFO Brief

O briefing aceita apenas afirmações com evidência, preserva o escopo e declara unsupportedClaimRate igual a zero porque a construção rejeita qualquer afirmação sem evidência. A saída continua simulationOnly.

## Cadeia analítica

pergunta → consulta autorizada → métrica determinística → evidência → explicação

O LLM, quando autorizado em etapa futura, poderá explicar o resultado, mas não poderá inventar fatos, promover score ou emitir ação.

## Não implementado

- dashboard ou UI de produção;
- taxonomia DRE autoritativa do Grupo Erick;
- warehouse analítico persistente;
- ação gerencial autônoma;
- promoção de anomalia a fraude ou sanção.
