# Atualização visual da operação Shirley

Escopo: área interna (Operação diária, Portal da Shirley, Visão geral, Pendências, Pedidos, Clientes, Produtos, Agenda, Financeiro, Relatórios e Configurações). A loja do cliente mantém suas folhas de estilo e suas regras de negócio.

## Auditoria antes da alteração

Zoom de 100%, resolução CSS e escala do dispositivo 1: 1366, 1440 e 1920 px.

| Medida | Antes | Depois |
| --- | --- | --- |
| Conteúdo em 1920 px | 1360 px | 1360 px, limite adequado preservado |
| Título das páginas dinâmicas | 48 px | 28 px |
| Corpo da lista de clientes | 15 px | 15 px, preservado |
| Barra de filtros de Pedidos | 237,5 px | 63,5 px no desktop |
| Clientes | lista limitada a 1080 px no card | lista ocupa toda a área útil do card |

Tokens exclusivamente em `assets/staff-tokens.css`. `assets/staff-ui.css` define as adaptações internas dos componentes antigos. Ambos são isolados por `body.staff-mode`; a classe é removida na rota da loja. As regras antigas necessárias à loja foram preservadas; as adaptações internas resolvem sua precedência sem alterar as cores do cliente.

## Aplicação

- Shell com grupos Operação, Cadastros e Gestão, rótulos visíveis e recolhimento manual persistido. Barra superior de 56 px.
- Cabeçalhos e componentes compartilhados de card, métrica, estado, badge, linha de lista e gráficos em `src/staff-components.js`.
- Kanban com três colunas iguais sempre abertas, rolagem por coluna, resumo fino e data inline. Movimentação por arrastar e seletor acessível preservada.
- Pendências separadas em Pedidos a conferir, Saldos em aberto e Avisos Pix. Catálogo mantém alertas quando necessário.
- Pedidos com busca e filtros compactos; opções extras permanecem abertas ao editar. Linhas inteiras abrem os pedidos.
- Clientes, Pendências e Agenda usam a mesma linha de lista. Clientes conserva busca, segmentos financeiros e histórico.
- Produtos com indicadores em linha, filtros compactos, fotos maiores e ação no cabeçalho.
- Agenda com faixa horizontal de dias e seleção destacada.
- Financeiro com períodos segmentados, datas personalizadas recolhidas, eixo monetário e tooltips acessíveis por foco, e divisão proporcional de recebido e em aberto. Cálculos e fontes de dados financeiros preservados.
- Relatórios, configurações, formulários internos e Portal da Shirley adaptados aos mesmos tokens.

## Validação

Auditoria adicional em 1024 e 390 px: tabelas têm rolagem no próprio contêiner, sidebar usa menu abaixo de 1024 px, grids reduzem as colunas. Inspeção de contraste AA, fontes mínimas e transbordamento nas onze rotas, com dados sintéticos locais. Comparação de estilos computados do portal com a referência anterior em 1920 px, incluindo cabeçalho, botões, boas-vindas e produtos.

Verificações: `npm run check` e `npm run test:ui` (autenticação, pagamentos, fotos, movimento, operação, identidade visual e checkout). A regressão de checkout inclui primeira compra, segunda tentativa bloqueada e falha de rede nas contas cliente, operação e Master.

## Arquivos alterados

- `.gitignore`: ignora somente as imagens e relatórios locais desta auditoria.
- `assets/staff-tokens.css`: tokens e adaptadores de variáveis da operação.
- `assets/staff-ui.css`: componentes e composições internas com escopo isolado.
- `src/staff-components.js`: componentes de apresentação compartilhados.
- `assets/screens.js`: composição, filtros, agenda, períodos, navegação e gráficos.
- `assets/clientes.js`: linha padrão e badges financeiros.
- `assets/catalogo.js`: filtros extras e estado vazio compartilhado.
- `assets/operacao.js`: kanban sempre expandido e cards compactos.
- `index.html`: grupos de navegação, cabeçalhos e folha interna.
- `tests/design-ui.mjs`: nova paleta, recolhimento explícito, filtros e períodos.
- `tests/photos-ui.mjs`: usa o ciclo operacional da tela para manter a verificação de nomes longos independente do horário.
- `tests/identity-audit.mjs`: permite fonte monoespaçada exclusivamente nos códigos dos pedidos.
- `tests/portal-routing-fixture.html`: inclui a folha interna para testar o isolamento durante o checkout.
- `docs/atualizacao-shirley.md`: escopo, medidas e evidências de validação.
