# Fotos oficiais — 30/09/2026

30 originais recebidos e copiados sem alteração para `assets/products/oficiais`.
O mapa auditável está em `src/product-photos.js` (nome original, arquivo e ID do produto).
16 fotos associadas ao catálogo por ID, tanto no modo local já existente quanto no Supabase.
Fotos personalizadas já cadastradas têm prioridade. Nenhum preço, custo, pedido ou disponibilidade foi alterado.
Não é necessário executar SQL para essas fotos: os produtos importados são reconhecidos pelo ID.
Um banco sem o catálogo importado continua sem produtos; as fotos não fazem importação comercial.

## Correspondências

Pão francês; pão de batata/milho (foto de batata); pão de queijo; mini donuts;
donuts; biscoito frito; broa; biscoito da vovó; cookies; rosquinha de queijo;
sonho; mini salgados; biscoito de queijo; biscoitão; biscoito de nata;
fatia bolo cenoura/chocolate (foto da fatia de cenoura com chocolate).

## 14 fotos aguardando identificação comercial

O catálogo tem itens genéricos como “Bolo” e “Rosca Diversas”, mas não distingue
os sabores abaixo. Não presumir que todos têm o mesmo preço, custo ou unidade:

- Florinda com goiabada
- Bolo de fubá (inteiro, não a fatia já cadastrada)
- Rosca húngara
- Rosca creme
- Rosca rondant (nome conforme arquivo recebido)
- Bolo mesclado
- Bolo de churros
- Bolo de laranja
- Bolo de queijo (arquivo “BOLO DE QUEIJO QUEIJO”)
- Rosca de creme com coco
- Bolo de chocolate
- Pamonha assada
- Bolo de cenoura com chocolate (inteiro)
- Rosca frita

Confirmar se são variações dos itens existentes ou produtos separados, com preço,
custo e unidade correspondentes, antes de disponibilizar para compra.

## Documentos recebidos junto das fotos

Os dois textos de prioridades recebidos são duplicados. Descrevem pagamentos
separados do estado operacional, Pix por provedor, fechamento diário, indisponibilidade
e substituições, edição do cliente antes da conferência, recompra, favoritos,
avisos de novos pedidos, central de pendências, conta corrente e histórico de margem.
São referência para uma próxima etapa; esta integração de fotos não implementa
nem ativa essas funcionalidades ou um provedor de pagamentos.
