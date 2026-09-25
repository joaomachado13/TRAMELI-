# Trameli — fluxo operacional a validar

Este documento registra o entendimento da conversa de 23/09/2026. Não substitui a validação com a operadora. O painel principal ainda usa dados demonstrativos; o primeiro recorte funcional da operação está descrito abaixo.

## Primeiro recorte implementado

A seção `#operacao` de `index.html`, integrada à mesma navegação lateral das demais áreas, já permite lançar pedidos manualmente com cliente, endereço, data, itens, quantidades, preços unitários, taxa de entrega e observações; editar/excluir pedidos; marcar conferidos; ver soma de produtos e total cobrado na data; e gerar um rascunho A4 de fichas em lote. Os dados ficam apenas no armazenamento local do navegador, sem autenticação, sincronização ou backup. Não usar com dados reais como registro definitivo. O modelo impresso é provisório e não está calibrado para a folha pré-cortada. O cálculo de repasse não foi implementado.

Em 23/09/2026, os registros e indicadores fictícios do painel foram retirados. O armazenamento local antigo (`trameli-operation-draft-v1`) é apagado na próxima abertura, e a operação passa a usar uma base vazia (`trameli-operation-draft-v2`). A preferência visual de movimento não é um dado de pedido e foi preservada. A partir daqui, o desenvolvimento segue por partes, com dados reais e regras validadas.

As abas não devem ser apenas avisos vazios. O recorte seguinte adicionou cadastro local de produtos (nome, preço, unidade, categoria e disponibilidade) e de clientes (nome, telefone e endereço), com edição e exclusão. Ambos podem ser reaproveitados no formulário de pedido. Pedidos, visão geral, agenda, resumo de valores e extrato por intervalo passam a refletir os pedidos lançados. Isso ainda não constitui autenticação de clientes, pagamento registrado, repasse calculado, agenda com horário ou armazenamento seguro multiusuário; esses fluxos permanecem para validação e implementação posterior.

## Hierarquia do produto

A operação diária é a entrada e o centro do produto. Pedidos, conferência, impressão e totais precisam estar a um passo. Clientes, histórico, relatórios e configurações são áreas de apoio à operação — não um CRM que contém o trabalho diário como módulo secundário. Por isso, abrir `index.html` sem uma seção específica mostra a operação dentro do mesmo painel e da mesma barra lateral; a visão geral e o CRM são outras seções dessa interface. O antigo `operacao.html` apenas encaminha links anteriores para `index.html#operacao`.

### Área futura do cliente

- Pedido de amanhã em aproximadamente um minuto: sessão de retorno, endereço salvo, itens habituais no topo, ajuste de quantidades e confirmação final.
- “Repetir meu último pedido” é o atalho inicial mais simples; a recorrência automática por vários dias (por exemplo, 30) vem depois que existirem regras de pausa, alteração, disponibilidade e aviso.
- Cliente vê seus próprios pedidos e pode corrigir ou remover itens enquanto o pedido ainda estiver aberto para alterações. Depois da confirmação ou do horário limite, a interface deve pedir uma alteração à operadora em vez de modificar silenciosamente a lista já enviada à padaria. O horário e os estados exatos ainda precisam ser validados.
- A operadora também pode acrescentar, editar ou remover pedidos e itens recebidos no privado ou fora do portal. Alterações devem registrar autoria e horário quando houver banco de dados e contas de usuário.

## Problema principal

Hoje os pedidos chegam em um grupo do WhatsApp. Os clientes enviam à noite o que desejam receber na manhã seguinte, junto com nome e endereço; o telefone também é anotado pela operadora quando necessário. Com cerca de 60 pedidos por dia, ela transcreve as mensagens, soma os valores, reúne o total para informar à padaria fornecedora e monta manualmente, no Word, fichas individuais para imprimir. O sistema deve eliminar a repetição desses passos e oferecer conferência antes de fechar o dia.

## Ciclo diário atual

1. À noite, os clientes enviam os pedidos no grupo do WhatsApp para o dia seguinte.
2. A operadora lê as mensagens e anota itens, quantidades, nome, endereço e, quando necessário, telefone.
3. Ela calcula os valores e reúne o total dos pedidos para comunicar à padaria fornecedora. A periodicidade do acerto financeiro ainda não foi confirmada.
4. Ela organiza os dados de cada pedido em um quadrinho no Word e imprime em folhas A4 pré-cortadas/serrilhadas. Os quadrinhos são destacados e usados na separação dos pedidos.
5. As entregas acontecem na manhã seguinte. O horário limite para receber ou alterar pedidos ainda precisa ser confirmado.

## Jornada proposta do cliente

1. Recebe um link e cria cadastro no primeiro acesso com nome, telefone e endereço de entrega; coletar outros campos somente se necessários ao pedido.
2. Nos acessos seguintes, encontra sua conta por uma sessão persistente no aparelho, com forma simples e segura de recuperar o acesso ao trocar de celular. Não usar identificação oculta do aparelho como substituto de autenticação.
3. Encontra primeiro os itens que costuma comprar, sua última combinação de pedido e um catálogo simples de pães, bolos e demais produtos. Recomendações comerciais só entram quando houver regras claras e transparência no preço.
4. Seleciona itens e quantidades, confirma endereço, entrega/retirada, observações e confere um resumo com produtos, taxa e total antes de enviar.
5. O pedido entra na central para análise; a aceitação automática e o pagamento online dependem de validação operacional. Pix é a única forma de pagamento considerada por enquanto, mas sua implementação permanece em estudo.

## Jornada proposta da operadora

1. Recebe uma fila única de pedidos, incluindo os lançados manualmente quando chegarem pelo WhatsApp.
2. Confere cada pedido, corrige itens ou quantidades quando necessário e registra sua situação. Mudanças de preço e disponibilidade precisam de um fluxo de confirmação definido.
3. Visualiza totais calculados automaticamente por cliente e por dia, com discriminação de produtos, entrega, ajustes e pagamentos.
4. Visualiza separadamente o total a pagar à padaria fornecedora. O repasse não deve ser confundido com o valor cobrado dos clientes; sua fórmula ainda precisa ser definida.
5. Gera, em lote, uma folha A4 com 27 etiquetas de 70 × 33 mm (3 colunas × 9 linhas), com nome, endereço, itens, quantidades e total. Pedidos com mais de três itens recebem etiquetas adicionais para não omitir produtos. O alinhamento e a legibilidade ainda dependem de uma prova na impressora e na folha reais.
6. Consulta extratos e relatórios com datas inicial e final livres, além de atalhos como dia específico, semana, quinzena, mês, últimos 30 dias e ano. Pode ver toda a operação ou filtrar um cliente específico.

## Regras relatadas, ainda não fechadas

- Entrega frequente no Condomínio Esplêndido, bairro Laranjeiras, em Uberlândia.
- Taxa habitual de entrega de R$ 2,00 por cliente/pedido. Confirmar exceções, retirada, vários pedidos no mesmo endereço e destino da taxa.
- Catálogo deve refletir pães e produtos reais de padaria, além de bolos e outros itens efetivamente vendidos.
- O volume informado é de aproximadamente 60 pedidos por dia, com recebimento à noite e entrega na manhã seguinte; confirmar apenas a variação entre dias comuns e dias de pico.
- A planilha de preços de venda e compra foi recebida em 24/09/2026. Em 25/09/2026, foram informados novos preços para os quatro frios (todos por kg), Pão de forma, Mini pão francês e manteigas. Dos 81 itens, 79 estão disponíveis; permanecem inativas somente as linhas antigas duplicadas de Pão de forma (R$ 9,50) e Mini pão (R$ 0,65). As fotos ainda não foram recebidas.
- O catálogo local agora usa os preços da planilha, mas pedidos em modo local são apenas de teste. Custos da padaria não são publicados no portal e o valor cobrado não equivale a pagamento recebido nem a repasse definido.

## Decisões para a conversa com a operadora

1. Pedidos: horário limite à noite, mudanças após o fechamento, cancelamentos e tratamento de falta de produto.
2. Catálogo: confirmar custos da padaria sem correspondência segura e fotos dos itens. Definir quem pode alterar preços e revisar unidades dos demais produtos ainda não validados em operação.
3. Fornecedor: confirmar se o total comunicado corresponde aos preços cobrados dos clientes ou a uma tabela própria da padaria; definir quando e como ocorre o acerto financeiro, além do tratamento de perdas, devoluções e taxa de entrega.
4. Cobrança: quando o cliente paga, para qual conta vai o Pix e como o pagamento é conferido; decidir depois se haverá Pix integrado ou apenas instruções/registro manual.
5. Entrega: endereços fora do condomínio, taxa por pedido ou endereço, agrupamento de pedidos e quem realiza a entrega.
6. Impressão: obter uma folha vazia e uma folha já preenchida para confirmar dimensões, quantidade de quadrinhos por A4, orientação na impressora, campos obrigatórios e necessidade de reimpressão.
7. Histórico: conteúdo exato dos extratos individuais e regras para pagamentos parciais ou fiado, se existirem.

## Ordem sugerida de implementação

1. Validar um dia real de trabalho com pedidos e uma folha impressa, ocultando dados pessoais de clientes quando possível.
2. Modelar cadastro, catálogo, pedidos, itens, taxas, pagamentos e repasse como registros separados.
3. Construir o fluxo interno mínimo: entrada/conferência de pedidos, totais e impressão em lote.
4. Construir o portal móvel do cliente com cadastro, retorno sem redigitar dados e repetição de pedido.
5. Adicionar extratos e relatórios; avaliar Pix integrado e automações de WhatsApp depois de validar o fluxo básico.

Prioridade de UX: reduzir digitação, evitar erros de conta e deixar a folha do dia pronta para imprimir. Animações devem apoiar a compreensão da interface, nunca atrasar essas tarefas.
