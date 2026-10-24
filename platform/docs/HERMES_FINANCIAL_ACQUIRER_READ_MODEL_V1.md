# Hermes — Financeiro: comparação PDV x adquirente (read-only V1)

**Contrato:** Maestro = Control Plane; Hermes = Execution Plane; Simulation First e fail closed. Evolução, não recriação.

## Incremento entregue

- Uma função pura de comparação reutilizável no domínio Financeiro existente: **financeiro-card-acquirer-read-only.js**.
- Usa dados de PDV e adquirente **já normalizados e previamente autorizados**, por provedor, loja, estabelecimento, referência de transação, parcela e período.
- Escopo recebido do ingress confiável: tenant, empresa, usuário, lojas permitidas e permissão financeiro.receivables.read. **A função não autentica JWT nem valida membership**: isso permanece no Maestro/ingress antes de qualquer invocação.
- Rejeita registros de outro tenant, empresa ou loja, duplicidades, fontes sem par, períodos incompatíveis, campos desconhecidos incluindo dados de cartão/portador, valores não inteiros e lotes excessivos.
- Compara BRL em centavos **por parcela**. A equivalência de identificadores entre sistemas só pode ser estabelecida por um adaptador homologado com evidência; não por coincidência de valor e data.
- Para fontes incompletas, indica cobertura não confirmada. Não afirma divergência por ausência de dados quando a cobertura não é comprovada.
- Devolve contagens por provedor e período, metadados de origem e no máximo dez referências opacas **locais àquele relatório** (case_001 etc.), não estáveis entre execuções; não expõe identificadores transacionais originais nem detalhes dos portadores.
- Sem rede, API, OAuth, banco, alterações financeiras ou recebimento. Retorno declara explicitamente ausência de execução, pagamentos, conciliação Linx ou liquidação bancária.

## Próximos gates de uso real

1. Finalizar o E2E documental humano no Compras Homologação (sem escrever eventos fictícios).
2. Homologar acesso à Senff ou Rede por API, arquivo ou outro meio oficial, segundo seus contratos e permissões reais.
3. Reutilizar lifecycle, provider registry, adapter e gateway já existentes, nunca duplicá-los.
4. Armazenar credenciais por tenant/empresa/estabelecimento fora de código e logs; habilitar somente leitura por escopo autorizado, com feature flag off por padrão e kill switch.
5. Criar normalizadores para dados reais e validar datas, paginação completa, identificadores compartilháveis, parcelas, cancelamentos, provenance e freshness.
6. Testar autenticação, RLS, tenant A/B, companhia A/B, loja A/B, isolamento de cache/auditoria e o canal escolhido antes de publicar.
7. Evoluir a conciliação para taxas, antecipações, chargebacks, valores líquidos e extrato bancário apenas quando houver fontes e contratos apropriados.

**Não confundir com integração ativa Senff/Rede nem conciliação contábil/bancária.** Nenhuma credencial ou dado financeiro real foi usado neste incremento.

Teste: node --test test/financeiro-card-acquirer-read-only.test.js.
