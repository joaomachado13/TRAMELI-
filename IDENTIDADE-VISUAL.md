# Trameli — identidade visual v1

## Conceito

Trameli é a central que conecta relacionamento, pedidos, produção, entrega e pagamento em um só percurso. O nome aproxima **trama** (partes conectadas) de uma sonoridade leve e acolhedora, adequada ao universo da confeitaria sem limitar o produto a um doce específico.

**Assinatura:** Cada pedido no seu caminho.

**Posicionamento:** organização com cuidado humano. A interface deve parecer confiável e calma, sem perder o calor artesanal do negócio.

## Marca

- **Nome de exibição:** Trameli. Sempre com T maiúsculo; nunca em caixa-alta no logotipo.
- **Descritor funcional:** Central de pedidos. Use abaixo do nome quando o contexto não explicar o produto.
- **Símbolo:** linha contínua que se dobra como um percurso e termina em um ponto dourado. Representa a passagem do pedido por cada etapa até a conclusão. Fonte vetorial: `assets/brand-mark.svg`.
- **Uso compacto:** somente o símbolo, sem nome, na barra lateral estreita e em favicons.
- **Área de respiro:** no mínimo metade da altura do símbolo em todos os lados.
- **Não fazer:** girar o símbolo, aplicar sombras fortes, usar outros ícones como substituto do símbolo, ou misturar versões diferentes do logotipo.

## Cores

| Papel | Nome | Valor | Uso |
| --- | --- | --- | --- |
| Base | Verde noite | `#07130B` | fundo profundo |
| Superfície | Verde floresta | `#102817` | navegação, cartões e painéis |
| Ênfase | Verde musgo | `#29452A` | seleção e estados positivos |
| Marca clara | Verde folha | `#C7D69B` | traço do símbolo, ícones e destaques |
| Marca quente | Mel suave | `#D7AD70` | ponto do símbolo e acentos pontuais |
| Texto principal | Creme | `#F4EEDF` | títulos e conteúdo prioritário |
| Texto auxiliar | Sálvia | `#A7AF9D` | informações secundárias |

O verde é dominante. O mel deve ocupar pouco espaço: ele chama a atenção para detalhes, não para grandes fundos. Status operacionais mantêm cores semânticas próprias e nunca dependem só da cor para comunicar significado.

## Tipografia

- **Expressiva:** Cormorant Garamond Medium (`500`) em marca, saudação e mensagens editoriais.
- **Funcional:** DM Sans Regular/Medium/Semibold (`400`, `500`, `600`) em navegação, indicadores, tabelas, formulários e botões.
- **Hierarquia:** títulos amplos e leves; rótulos e dados compactos e legíveis. Evitar muitos pesos ou fontes adicionais.

As fontes são carregadas localmente em `assets/`, para que o painel mantenha a mesma aparência sem conexão.

## Elementos de interface

- Ícones lineares de uma única família visual, com traço claro e alinhamento central. Não misturar emojis ou ícones preenchidos no mesmo conjunto.
- Cartões de cantos suaves, borda fina translúcida e gradientes discretos. Evitar sombras duras.
- Fundo verde com movimento luminoso lento e sutil. Respeitar a preferência de movimento reduzido.
- Fotografia de doces pode entrar como acento editorial, sempre com contraste suficiente para o texto.
- Na home, mostrar primeiro informações que exigem ação; depois pedidos, entregas, clientes e conteúdo editorial.
- Usar pontos e badges de prioridade pequenos, com texto acessível; nunca depender apenas da cor.
- No celular, a navegação fica em menu lateral temporário e a lista de pedidos vira cartões legíveis.
- Hover, foco e abertura de detalhes devem ser discretos e rápidos, sem movimento chamativo.

## Voz e conteúdo

Tom direto, gentil e operacional. Exemplos: “Tudo em ordem, do pedido à entrega.”, “Pedidos recentes”, “Próximas entregas”. Evitar jargão técnico e frases promocionais em áreas de trabalho.

O produto não leva o nome de uma pessoa. Até que o nome do titular da conta seja informado, usar **Minha conta** e saudações neutras, como **Bom dia!**. Dados de clientes nos exemplos são demonstrativos.

## Aplicação

O dashboard e as telas internas em `index.html` são a primeira aplicação desta identidade. O futuro portal do cliente deve reutilizar a paleta, os arquivos de fonte, o símbolo, os ícones, os espaçamentos e o tom definidos aqui. Alterações de identidade devem ser feitas neste documento antes de se espalharem pelas telas.

As telas atuais usam dados demonstrativos e navegação local. Cadastro, edição, busca, notificações e persistência dependem da próxima fase de desenvolvimento.

> Nome proposto para este projeto. A pesquisa inicial na web não substitui verificação formal de marca, domínio ou registro antes de uso comercial público.
