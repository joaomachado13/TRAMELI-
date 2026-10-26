# Histórico de versões

## 0.5.0 — PWA e notificações

- Pão Doce instalável como PWA em Android e iPhone.
- Web Push real por aparelho, com caixa de avisos e badge quando suportado.
- Central de Notificações para a operação, com envio manual e histórico.
- Avisos automáticos de pedidos, lembretes de pagamento e lembrete de pedido habitual.
- Deep links para abrir pedido, catálogo e pagamentos diretamente pela notificação.
- Service worker em modo network-only para não servir pedidos ou pagamentos desatualizados.
- Atalhos do aplicativo para Fazer pedido, Meus pedidos e Operação diária.


## 0.4.0 — Pão Doce

- Marca Pão Doce (nome, logo, cores ajustadas) no lugar de Trameli.
- Repasse da padaria com preço de custo: diário, quinzenal (fechamentos dia 15 e último dia) e mensal, em PDF e texto.
- Exclusão de pedido com pagamento vinculado: manter o pagamento ou excluir os dois (migração 202610160018).
- Etiquetas ordenadas por rua e número da casa.
- Contagem do próximo fechamento também para a operação.
- Migração 202610160019: nome e paleta padrão no banco.


## 0.3.0 — 2026-10-02

### Experiência e operação

- Operação diária reorganizada em Kanban com três etapas e detalhes em painel lateral.
- Visão Geral, Pedidos, Clientes, Produtos, Agenda e Financeiro simplificados para leitura progressiva.
- Relatórios passaram a ser gerados sob demanda, com saída preparada para PDF.
- Configurações reorganizadas por categorias.
- Busca global para clientes, pedidos e produtos.

### Portal do cliente

- Saudação personalizada, orientação em três passos e acesso rápido ao último pedido.
- Recompra, pedidos favoritos e planejamento semanal.
- Endereço e telefone reaproveitados nos próximos pedidos.
- Seleção de pagamento revisada e transferência bancária removida do checkout.

### Design system

- Verde floresta reservado para identidade, navegação, ações e estados.
- Creme quente como superfície principal de trabalho.
- Tipografia sans-serif priorizada nas áreas operacionais e serifada preservada nos momentos editoriais.
- Escala consistente de espaçamento, raios, botões, inputs, cards e badges.
- Sidebar persistente em desktop e menu recolhível em telas menores.
- Portal, login e painel Master alinhados à mesma linguagem visual.

### Qualidade

- Nova cobertura visual das principais rotas em 390 px, 1280 px, 1350 px e 1440 px.
- Testes de navegação persistente, contraste, responsividade e ausência de rolagem horizontal.
