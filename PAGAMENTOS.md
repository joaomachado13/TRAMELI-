# Recebimentos, conta corrente e fechamento diário

Implementados no código em 30/09/2026. **Aplicação de 007/008 no Supabase real confirmada pelo usuário; testes automatizados executados em banco isolado.**
Não há provedor Pix contratado, cobrança bancária criada, webhook ativo ou transferência de dinheiro.
O usuário informou que aplicou a ativação 007/008. Pix manual com QR e Copia e Cola está em `PIX-MANUAL.md`
e requer uma etapa nova (009), sem reaplicar 007/008. Integração paga não faz parte da opção atual.

## Ativar

1. Primeiro concluir a ativação do catálogo (002–005) e dos acessos (006). Não reaplicar esses arquivos.
2. Fazer backup verificável antes de mudar a estrutura do banco.
3. Executar TODO `supabase/activate-payments-shopping.sql` uma vez no SQL Editor. O arquivo aplica 007 e 008 juntos, em uma transação. Se uma delas já tiver sido aplicada separadamente, ele aborta sem alterações; use apenas a migração faltante após conferir.
4. Atualizar o site. Em **Financeiro**, aparecem recebimentos, conta corrente e fechamento.
5. Conferir em ambiente de teste com duas contas distintas antes de usar valores reais.

Sem a migração, a interface informa a pendência e não inventa saldos ou simula pagamentos reais.

## Operação

- Escolher uma conta → **Ver extrato / registrar pagamento**. Informar a parcela recebida em cada pedido.
- Um recebimento pode quitar vários pedidos da mesma conta. A soma distribuída deve bater com o valor.
- Pedidos manuais sem `customer_id` são contas separadas POR PEDIDO. Nomes ou telefones semelhantes não provam identidade.
- Métodos: Pix conferido manualmente, dinheiro, transferência e outro. Marcar só após conferir o recebimento externo.
- Valores sem identificação ficam em uma fila própria. Selecionar a conta e distribuir o valor integral para vinculá-los.
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
limites no banco, bloqueio de saldo excedente e bloqueios de linhas para concorrência.
Recebimentos/devoluções têm chaves de idempotência para reenvios. Não existem edição nem exclusão direta de lançamentos pela aplicação.
Responsável e horário de registro e vinculação ficam gravados no banco.

`npm run check` inclui os testes PostgreSQL em `tests/payments.test.mjs`.
`node tests/payments-ui.mjs` usa navegador com perfil temporário e dados fictícios, sem banco remoto.
Cobertura: parcial, múltiplos pedidos, identidade de conta, não identificado, RLS, reenvio,
devolução, cancelamento, preservação de fechamento, formulário e tela pequena.

## Próximas etapas do texto de prioridades

Recompra, favoritos e frequentes estão descritos em `RECOMPRA.md`.
Ainda não entregues: Pix integrado ao provedor,
aviso instantâneo, indisponibilidade por período/substituição, central completa de pendências
e histórico de alterações do preço/custo do catálogo. O bloqueio de edição do cliente após
conferência e o registro de preços/custos no pedido já existem; não equivalem ao histórico completo do catálogo.
