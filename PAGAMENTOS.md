# Recebimentos, conta corrente e fechamento diário

Implementados no código em 30/09/2026 e ajustados às regras aprovadas em 01/10/2026. As migrations 010 e 011 foram aplicadas no Supabase real; a migration 012 adiciona os recursos operacionais gratuitos descritos abaixo.
Não há provedor Pix contratado, cobrança bancária criada, webhook ativo ou transferência de dinheiro.
Pix manual com QR e Copia e Cola está em `PIX-MANUAL.md`. Integração paga não faz parte da opção atual.

## Ativar

1. No projeto atual, não reaplicar 001–009: a estrutura já foi confirmada. Em um projeto novo e vazio, aplicar as migrations na ordem.
2. Fazer backup verificável antes de mudar a estrutura do banco.
3. Executar TODO `supabase/activate-payments-shopping.sql` uma vez no SQL Editor. O arquivo aplica 007 e 008 juntos, em uma transação. Se uma delas já tiver sido aplicada separadamente, ele aborta sem alterações; use apenas a migração faltante após conferir.
4. Atualizar o site. Em **Financeiro**, aparecem recebimentos, conta corrente e fechamento.
5. Conferir em ambiente de teste com duas contas distintas antes de usar valores reais.

Sem a migração, a interface informa a pendência e não inventa saldos ou simula pagamentos reais.

## Operação

- Escolher uma conta → **Ver extrato / registrar pagamento**. Selecionar os pedidos que foram pagos.
- Um recebimento pode quitar vários pedidos da mesma conta. Cada pedido selecionado deve ser quitado pelo saldo integral atual e a soma precisa bater com o valor recebido.
- Pedidos manuais sem `customer_id` são contas separadas POR PEDIDO. Nomes ou telefones semelhantes não provam identidade.
- Métodos: Pix conferido manualmente, dinheiro, transferência e outro. Marcar só após conferir o recebimento externo.
- Valores sem identificação ficam em uma fila própria. Para vinculá-los, selecionar pedidos completos da mesma conta cuja soma seja exatamente o recebimento.
- Estorno preserva o lançamento original e cria uma contrapartida. Esta versão registra **devolução integral** já realizada externamente; não faz Pix de volta nem estorno parcial.
- Cancelamento ou redução do total de um pedido pago pode gerar **devolução pendente**. Não há compensação automática com outra dívida.
- Pedidos entregues podem ficar em aberto; pedidos em separação podem estar pagos.
- Cliente consulta **Meus pedidos → Minha conta corrente** e vê só seus valores, sem custo da padaria, referências e notas internas.
- Pedidos antigos começam sem recebimentos registrados. Isso não afirma que não foram pagos fora da plataforma: a operação precisa reconciliá-los.

## Fechamento

- Escolher hoje ou uma data passada. O resumo é calculado no servidor.
- Vendas/custos/saldos usam a data de ENTREGA dos pedidos.
- Recebimentos/devoluções do dia usam a data de REGISTRO do lançamento, no fuso de São Paulo. Não há lançamento retroativo nesta versão.
- Custos ausentes deixam lucro pendente; custos estimados deixam lucro provisório. Entrega não entra no lucro bruto dos produtos.
- **Fechar dia** salva uma fotografia imutável com totais e saldos por pedido. Um novo fechamento gera outra revisão; não bloqueia correções.
- Valores são brutos: taxas do futuro provedor e outras despesas não estão descontadas.

## Segurança e testes

Gravações só por RPC com papel operadora/master. Clientes não podem confirmar recebimentos,
consultar extratos alheios, consultar notas internas ou alterar fechamentos. Valores em centavos,
limites no banco, proibição de valor parcial arbitrário e bloqueios de linhas para concorrência.
Recebimentos/devoluções têm chaves de idempotência para reenvios. Não existem edição nem exclusão direta de lançamentos pela aplicação.
Responsável e horário de registro e vinculação ficam gravados no banco.

`npm run check` inclui os testes PostgreSQL em `tests/payments.test.mjs`.
`node tests/payments-ui.mjs` usa navegador com perfil temporário e dados fictícios, sem banco remoto.
Cobertura: quitação integral, rejeição de parcial arbitrário, múltiplos pedidos, identidade de conta, não identificado, RLS, reenvio,
devolução, cancelamento, preservação de fechamento, formulário e tela pequena.

## Próximas etapas do texto de prioridades

Recompra, favoritos e frequentes estão descritos em `RECOMPRA.md`.
Entregues sem provedor pago na migration 012: aviso “já paguei” que **não confirma pagamento**,
atualização em tempo real dentro do sistema, indisponibilidade por período com substituto apenas
sugerido, central de pendências e histórico de preço/custo do catálogo. Continua fora do escopo
o Pix integrado a um provedor, webhook bancário e qualquer confirmação automática de recebimento.
