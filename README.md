# Trameli

Protótipo local da central de pedidos, com operação diária, catálogo, clientes e visões de apoio no mesmo painel.

## Abrir

Abra `index.html` no navegador. Não há etapa de instalação nem servidor obrigatório nesta versão.

## O que funciona neste recorte

- Lançar, editar, conferir e excluir pedidos.
- Cadastrar produtos e clientes para reaproveitar dados nos pedidos.
- Explorar o portal mobile em `index.html#loja`, montar a sacola, informar a entrega e confirmar um pedido que entra na fila da operação.
- Ver, alterar ou cancelar no mesmo navegador pedidos do portal que ainda não foram conferidos.
- Ver pedidos por data, totais, agenda e extrato simples por período.
- Preparar um rascunho A4 de fichas para impressão.

O catálogo inicial tem 20 produtos de padaria, fotos geradas para esta demonstração e **preços ilustrativos**, que devem ser substituídos pelos valores confirmados. A carga inicial só acontece uma vez e não sobrescreve um catálogo existente.

Os registros ficam apenas no armazenamento local do navegador. **Não compartilhe o portal com clientes reais nem use dados pessoais reais nesta versão**: não há contas, banco de dados compartilhado, sincronização entre aparelhos, backup, cobrança Pix ou cálculo de repasse. O retorno sem redigitar dados só funciona no mesmo navegador. A folha impressa ainda não foi calibrada para o papel pré-cortado usado na operação.

## Verificações

Com Node.js e Microsoft Edge instalados no Windows:

```powershell
node tests/smoke-ui.mjs
node tests/operation-ui.mjs
```

Os testes criam capturas em `assets/crops/`, pasta ignorada pelo Git.

As regras conhecidas e as pendências estão em `REQUISITOS-OPERACAO.md`.
