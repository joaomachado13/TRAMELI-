# Homologação operacional

Status em 01/10/2026: suíte local aprovada; homologação real bloqueada pelos pré-requisitos abaixo.

## Portões antes do piloto

- [ ] Primeiro backup criptografado copiado para o Google Drive.
- [ ] Restauração aprovada em projeto Supabase descartável conforme `RESTAURACAO.md`.
- [ ] Histórico remoto reconciliado para migrations 001–009 e migrations 010–011 aplicadas.
- [ ] Advisor de segurança sem funções internas expostas; proteção de senhas vazadas habilitada.
- [ ] URL de staging HTTPS e redirects do Auth configurados.
- [ ] SMTP próprio testado para cadastro e recuperação de senha.
- [ ] Duas contas de cliente e uma conta de operadora/master exclusivamente de teste.
- [x] Regras de `REGRAS-NEGOCIO.md` aprovadas pela operação e automatizadas localmente.
- [ ] Impressora e folha 70 × 33 mm disponíveis para a prova física.

## Evidência automatizada já aprovada

- `npm run check`: autenticação, papéis, RLS isolada, cálculo servidor, catálogo, custos, pagamentos, favoritos, Pix e build de teste.
- `npm run test:ui`: autenticação, recuperação, pagamentos, Pix manual, fotos, recompra, operação, 390/1280 px, movimento reduzido e fluxo sem conexão.
- Os testes usam banco isolado/dados sintéticos e navegador com perfil temporário; não acessam contas reais.

## Roteiro no staging

1. Criar 60 pedidos para a mesma manhã, incluindo nomes semelhantes, endereços longos, frios por peso, pedidos duplicados, edição simultânea, cancelamento e produto indisponível.
2. Conferir independentemente produtos, taxa, total do cliente, custo da padaria, saldos e fechamento do dia.
3. Provar que cada cliente vê apenas seus próprios pedidos e que não consegue alterar preço, papel ou pedido alheio.
4. Em dois dispositivos, percorrer recebido → conferido → separação → pronto → entregue e confirmar atualização em até 15 segundos.
5. Simular internet interrompida durante envio e garantir que não aparece sucesso antes da resposta do banco; repetir com o mesmo identificador para provar idempotência.
6. Registrar Pix, dinheiro, quitação integral de um pedido, quitação conjunta de vários pedidos, pagamento não identificado, identificação posterior, cancelamento pago e devolução integral. Confirmar que valores parciais arbitrários são rejeitados.
7. Testar cadastro, logout, retorno de sessão e recuperação de senha em dispositivo diferente.
8. Imprimir a grade em A4 comum a 100%, sobrepor à folha de 27 etiquetas e validar bordas, endereço longo e pedido dividido.
9. Executar um dia acompanhado mantendo WhatsApp como contingência. A operadora registra aprovação, ressalvas e evidências.

## Critério de liberação

Produção só é aprovada quando todos os portões e casos estiverem registrados como aprovados, com responsável e data. Falha de isolamento, cálculo, restauração, autenticação ou impressão bloqueia a abertura; ajustes apenas visuais podem ser classificados separadamente.
