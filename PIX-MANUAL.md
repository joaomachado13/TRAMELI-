# Pix direto na conta, com baixa manual

Implementado em 30/09/2026. Sem Asaas/Mercado Pago, API bancária, webhook ou serviço externo de QR.
O cliente paga no aplicativo do banco; a operadora confere o extrato e registra o recebimento no financeiro.
Não há promessa de tarifa bancária zero. A tarifa depende da conta e do banco recebedor.

## Ativação

1. O usuário informou que aplicou 007/008. Não reaplicar o pacote anterior.
2. Após backup, aplicar somente `supabase/migrations/202609300009_manual_pix.sql` inteiro.
3. Entrar como Master → Financeiro → Configurar Pix.
4. No banco dela, gerar um Pix Copia e Cola ESTÁTICO REUTILIZÁVEL, sem valor fixo.
5. Colar o código, informar o titular como aparece no banco, conferir chave/titular e habilitar.
6. Validar a leitura e os dados em aplicativo bancário, sem precisar concluir uma transferência.
   A aceitação pelo banco real ainda não foi verificada: os testes usam exemplo fictício oficial.

O destino começa desativado. Somente Master altera; a configuração tem versão para impedir
sobrescrita concorrente e histórico privado de antes/depois com autor e horário.
O código do banco deve ser tratado como informação de recebimento que será visível aos clientes
autenticados. Uma chave aleatória pode evitar expor telefone/CPF no código.
Não cadastrar senhas, tokens ou credenciais bancárias.

## Cliente

- Em Meus pedidos → Minha conta corrente, escolher Pix de um pedido ou do saldo inteiro.
- O saldo é relido do banco de dados da Trameli. Pagamentos ainda não conferidos não reduzem esse saldo.
- O site preserva a chave do código cadastrado, preenche o valor em centavos e recalcula o CRC.
- QR e Copia e Cola são gerados no navegador, sem enviar chave/valor a um gerador externo.
- Cliente deve conferir titular e valor no próprio banco antes de autorizar.
- Nunca pagar de novo só porque a operadora ainda não conferiu o pagamento anterior.
- Mostrar, copiar ou fechar o QR não registra pagamento. Não existe botão que permita ao cliente se marcar como pago.
- Após cinco minutos a tela oculta o código e pede nova consulta. Isso NÃO expira nem invalida o Pix no banco:
  cópias, capturas ou transferências pela chave continuam possíveis. Não há trava bancária contra pagamentos repetidos.
- Este QR estático não cria uma cobrança bancária rastreada. A referência original é preservada,
  não é um identificador automático e exclusivo do pedido.

## Operação e entrega

Conferir o crédito no extrato → Financeiro → selecionar conta → distribuir o recebimento pelos pedidos →
Pix conferido manualmente → registrar. Comprovante enviado pelo cliente, sozinho, não prova o crédito.
Recebimentos sem identificação podem ficar na fila existente até conciliação.
Estado financeiro e estado de entrega seguem separados. R$ 2 de entrega só entra no resumo final,
e a receita de entrega continua separada do lucro bruto dos produtos.
60 entregas a R$ 2 representam R$ 120 de receita de entrega, não necessariamente lucro líquido.

## Limites e testes

Aceita perfil estático simples: campos ASCII, chave Pix, moeda BRL, país BR, nome/cidade,
referência e CRC íntegros. Recusa código com valor fixo de cadastro, URL dinâmica, saque, gorjeta,
recorrência, campos duplicados ou desconhecidos. Não consulta DICT nem verifica titularidade:
a conferência do Master e do pagador no banco é indispensável.

`node tests/pix.test.mjs`: exemplo BCB/CRC conhecido, centavos, preservação da chave, rejeições,
Master/operator/customer/anon, imutabilidade do histórico e configuração sem lançamento de dinheiro.
`node tests/payments-ui.mjs`: saldo parcial, QR, layout 390px, saldo zero/desativação,
conferência obrigatória e ausência de baixa automática.

Referências oficiais consultadas:
- https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Regulamento_Pix/II_ManualdePadroesparaIniciacaodoPix.pdf
- https://www.bcb.gov.br/meubc/faqs/p/quais-as-tarifas-relacionadas-ao-pix
- https://github.com/soldair/node-qrcode
