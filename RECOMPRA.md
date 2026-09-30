# Recompra, favoritos e frequentes

Implementados e testados em 30/09/2026. Recompra e frequentes utilizam o catálogo e os pedidos existentes.
Favoritos persistidos por conta precisam da migração 008. A ativação conjunta está em
`supabase/activate-payments-shopping.sql`; não reaplicar migrações já executadas.

- Meus pedidos → **Pedir novamente** monta uma sacola, sem enviar pedido nem pagamento.
- Antes de montar, no modo conectado, recarrega catálogo e histórico. Erro de rede interrompe a ação.
- Preços atuais, entrega para amanhã e nova chave de envio; não copia status, pagamento ou observação antiga.
- Produtos removidos/inativos ficam de fora com aviso. Preço alterado também gera aviso.
- Frios preservam pesos válidos em passos de 50 g. Mudança de unidade, peso inválido ou quantidade inválida exige escolha manual.
- Limite de 99 unidades/passos por produto; ajuste é informado. Sacola existente só é substituída após confirmação.
- **Favoritar** grava só na conta autenticada. Sem migração ou erro de leitura, o recurso fica indisponível e informa a causa.
- **Comprados com frequência** mostra até seis produtos ativos presentes em pelo menos dois pedidos próprios não cancelados.
- Busca, categoria e filtro pessoal podem ser combinados. Nenhuma recomendação usa histórico de outro cliente.
- Disponibilidade nesta etapa corresponde ao campo ativo do catálogo. Bloqueio por período/substituição ainda é outra etapa.

Testes: `node tests/shopping.test.mjs` (lógica e PostgreSQL/RLS/arquivo de ativação);
`node tests/photos-ui.mjs` (DOM real com dados fictícios, recompra, favorito e telas 390/1280).
