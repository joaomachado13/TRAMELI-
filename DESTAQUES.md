# Vitrine de destaques

A Shirley e o Master escolhem os produtos em **Produtos → abrir produto → Destaque na vitrine**. Marque **Exibir este produto nos destaques**, informe a posição e clique em **Salvar destaque**. Para retirar, desmarque e salve. A posição 1 aparece primeiro; empates seguem o nome do produto.

A seleção aparece no início da loja e na área de produtos do Portal da Shirley. Os cartões usam a foto e o preço atuais do cadastro, com os mesmos controles e quantidades do catálogo. Produtos inativos ou temporariamente indisponíveis para a entrega ficam fora dos destaques. Buscar produtos oculta a vitrine durante a busca. Favoritos e produtos frequentes continuam disponíveis.

## Ativação no banco

A migration `supabase/migrations/20261020172855_product_featured_position.sql` adiciona a posição opcional ao produto e a função `trameli_set_product_featured`. Apenas contas da operação podem alterá-la; clientes podem consultar os destaques. Nenhum produto vem selecionado por padrão e preços ou pedidos existentes não são alterados.

A migration foi validada em banco isolado e não é aplicada pelo deploy do site. Antes de aplicá-la ao projeto real, siga o backup com restauração de teste exigido em [PRODUCAO.md](PRODUCAO.md) e confira o histórico em [supabase/MIGRATIONS.md](supabase/MIGRATIONS.md). Não reaplique migrations antigas. Sem essa atualização, a tentativa de salvar informa que a vitrine precisa ser ativada pela administração.

## Validação

`npm run check` verifica seleção, ordenação, remoção e permissões no banco isolado. `npm run test:ui` verifica a escolha em Produtos, a sincronização das quantidades entre vitrine e catálogo, a busca, o Portal da Shirley e os layouts em celular e desktop.
