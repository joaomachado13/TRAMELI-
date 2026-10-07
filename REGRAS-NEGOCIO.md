# Regras de negócio aprovadas

Este documento separa o comportamento já implementado das decisões que dependem da operação. Nenhuma pendência abaixo deve ser presumida pelo sistema.

## Já implementado

- Taxa padrão do portal: R$ 2,00 por pedido.
- Produtos, taxa de entrega, custo da padaria e lucro bruto aparecem separados.
- Pix atual é estático e manual: mostrar/copiar QR não registra pagamento.
- A operadora só registra recebimento depois de conferir o crédito fora do sistema.
- Um recebimento pode quitar um ou mais pedidos da mesma conta, sempre pelo saldo integral atual de cada pedido selecionado. Valor parcial arbitrário não é aceito.
- Estorno é integral, preserva o lançamento original e apenas registra uma devolução feita externamente.
- Pedido pago e depois cancelado pode gerar devolução pendente; não há compensação automática.
- Estado financeiro e estado de entrega são independentes.

## Decisões aprovadas em 01/10/2026

1. **Horário de corte:** a partir da reunião de 07/10/2026, o padrão é **21h00 do dia anterior à entrega**, no fuso `America/Sao_Paulo`. O Master pode alterar esse horário em Configurações → Pedidos, e a mesma regra é validada no portal e no banco. Lançamentos manuais da operação continuam disponíveis como contingência e ficam auditados.
2. **Taxa de entrega:** R$ 2,00 por pedido, inclusive quando os clientes moram no mesmo condomínio. Não há retirada nem variação por endereço nesta versão.
3. **Momento e método de pagamento:** a cobrança padrão é quinzenal, com fechamentos no dia **15** e no **último dia do mês**. O cliente pode antecipar pagamentos, mas a operação não precisa cobrar antes do fechamento. O pedido pode avançar sem pagamento. O portal informa Pix, dinheiro ou **Acordado com a proprietária** como intenção; o recebimento só é confirmado pela operação depois da conferência externa.
4. **Pedidos inteiros, sem valor parcial arbitrário:** o cliente pode selecionar um ou mais pedidos e pagar exatamente o saldo integral de todos os pedidos escolhidos. Não pode digitar ou distribuir um valor parcial por pedido.
5. **Repasse à padaria:** corresponde à soma dos custos dos produtos na tabela da padaria para o período escolhido. A operação precisa consultar os totais diário, semanal e quinzenal. Itens sem custo confirmado deixam o repasse marcado como incompleto; não são presumidos como zero.

## Decisões complementares

- Depois de “conferido”, somente Master pode alterar conteúdo, reabrir ou cancelar. A operadora continua autorizada a avançar o fluxo normal para separação, pronto e entregue.
- A seleção de pedidos e as chaves de idempotência evitam registro duplicado dentro da Trameli. Como o Pix é estático, uma transferência externa duplicada ainda é possível; se ocorrer, deve ser conferida e devolvida externamente, com estorno registrado.
- Pedidos no mesmo condomínio continuam independentes e cada pedido recebe sua própria taxa de R$ 2,00.
- **Pendente:** prazo de retenção de pedidos, pagamentos e trilhas de auditoria.
- **Pendente:** decidir futuramente se o Pix manual será substituído por provedor com cobrança e webhook. Nenhum webhook será implementado agora.

As decisões 1–5 e as restrições de autoridade foram implementadas localmente na migration `20261001130152_approved_business_rules.sql` e cobertas por testes. A migration ainda não foi aplicada ao Supabase de produção: backup restaurável e homologação continuam obrigatórios.

## Decisões da reunião de 07/10/2026

- Entregas e planejamento semanal: **segunda a sábado**; domingo não é dia de entrega.
- O cliente deve ver aviso do próximo fechamento e, nos sete dias finais, contagem regressiva até o vencimento; atraso permanece visível até a baixa manual.
- Relatórios de cobrança precisam detalhar, por cliente, datas, itens, valores, total pago e saldo em aberto, com impressão/PDF individual, de clientes selecionados ou geral.
- O fluxo existente de Pix, comprovante e conferência manual é preservado; comprovante pode seguir pelo WhatsApp configurado ou pelo envio já existente no site.
- Dados de produtos citados na transcrição não são alterados automaticamente quando o nome/custo não estiver confirmado pela fonte oficial do catálogo.
