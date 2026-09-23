# Trameli

Protótipo local da central de pedidos, com operação diária, catálogo, clientes e visões de apoio no mesmo painel.

## Abrir

Abra `index.html` no navegador. Não há etapa de instalação nem servidor obrigatório nesta versão.

## O que funciona neste recorte

- Lançar, editar, conferir e excluir pedidos.
- Cadastrar produtos e clientes para reaproveitar dados nos pedidos.
- Ver pedidos por data, totais, agenda e extrato simples por período.
- Preparar um rascunho A4 de fichas para impressão.

Os registros ficam apenas no armazenamento local do navegador. **Não use dados pessoais reais nem esta versão como sistema definitivo**: não há contas, banco de dados compartilhado, backup, cobrança Pix ou cálculo de repasse. A folha impressa ainda não foi calibrada para o papel pré-cortado usado na operação.

## Verificações

Com Node.js e Microsoft Edge instalados no Windows:

```powershell
node tests/smoke-ui.mjs
node tests/operation-ui.mjs
```

Os testes criam capturas em `assets/crops/`, pasta ignorada pelo Git.

As regras conhecidas e as pendências estão em `REQUISITOS-OPERACAO.md`.
