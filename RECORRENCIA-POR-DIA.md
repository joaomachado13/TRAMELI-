# Produtos diferentes em cada dia

No Portal da Shirley, selecione o cliente, o início da programação e a repetição: por dias da semana, quinzenal ou mensal. Marque os dias de entrega e ative **Produtos diferentes por dia**.

Escolha um dia nos botões acima do catálogo e monte seu pedido. As quantidades e o resumo exibidos pertencem somente àquele dia. Para repetir uma combinação, abra **Copiar este pedido para outros dias**, marque os destinos e clique em **Copiar pedido**. Se os destinos já tiverem produtos, será solicitada confirmação antes de substituí-los.

Exemplo: monte 6 pães na segunda e copie para quarta e sexta. Na terça, monte 6 pães, presunto e mussarela, e copie para quinta e sábado. Salve a programação. Cada dia selecionado precisa ter pelo menos um produto; desmarque o dia se não houver entrega.

Mensal e quinzenal continuam definindo o fechamento da cobrança. Os produtos podem variar por dia da semana em qualquer uma das três opções. Domingo continua sem entrega. Ao editar uma programação, cada dia mantém suas quantidades. Desativar a opção aplica o pedido do dia aberto a todos os dias, após confirmação.

## Compatibilidade e ativação

A migration `20261020180634_recurring_items_by_weekday.sql` adiciona `items_by_weekday` opcional às programações existentes e uma RPC exclusiva da operação. Programações antigas mantêm o pedido comum. A geração usa os itens do dia selecionado e evita duplicação por data.

A migration `20261021220949_recurring_future_items_sync.sql` sincroniza também os itens e as observações dos pedidos futuros já gerados que continuam intactos, nos dias ainda selecionados. Mantém IDs e taxas de entrega. Hoje, histórico, alterações manuais, pedidos entregues, pagamentos e avisos de Pix pendentes ficam preservados. Uma versão de sincronização permite editar novamente uma ocorrência atualizada automaticamente, e os eventos e custos seguem os triggers existentes. A RPC `trameli_sync_recurring_future(uuid)`, exclusiva da operação, permite revisar uma programação já salva; repetir a chamada sem novas mudanças não reescreve pedidos.

Pedidos existentes em dias retirados da programação e exceções protegidas exigem conferência operacional. A geração de novas datas continua sendo solicitada pela operação; esta atualização não cria um agendamento automático.

Na Operação diária, editar uma programação com produtos por dia abre o Portal da Shirley. O caminho antigo de gravação rejeita a alteração de uma programação diária para evitar perda silenciosa de suas variações. A conversão explícita para um pedido comum é feita no Portal da Shirley.

Esta migration não é aplicada pelo deploy do site. Antes da ativação real, confira o histórico remoto e siga `PRODUCAO.md`. O último envio de backup ao Drive em 20/10/2026 falhou com `invalid_grant`; é necessário reconectar o rclone antes de considerar um novo backup concluído. A exceção autorizada para a migration anterior da vitrine não substitui a ativação desta atualização.

Validação: `tests/recurring-days-db.test.mjs` aplica todas as migrations em banco isolado e verifica dias alternados, pesos/totais, três frequências, renovação do ciclo, edição futura, idempotência e permissões. `tests/landing-ui.mjs` verifica alinhamento, controles circulares e criação/edição/cópia dos pedidos de cada dia em desktop e celular.
