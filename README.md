# Trameli — central de pedidos

O painel operacional e o portal do cliente compartilham a mesma aplicação. A versão sem configuração do Supabase é **somente demonstração local**; não use dados pessoais reais nela.

## Executar

```powershell
npm install
npm run dev
```

Abra o endereço local exibido pelo Vite. O arquivo `index.html` não deve mais ser aberto diretamente via `file://`, pois a aplicação usa módulos JavaScript.

```powershell
npm run check
npm run test:ui
npm run build
npm run preview
```

`dist/` é a saída para hospedagem estática. O catálogo local usa os preços transcritos da planilha recebida, mas pedidos desse modo continuam apenas no navegador e não devem conter dados pessoais reais. As fotos antigas de demonstração não são usadas no catálogo novo.
Os quatro frios confirmados são vendidos por kg; o portal e o lançamento manual selecionam 50 g por toque, calculando o valor da porção sobre o peso total. Por exemplo, 50 g de mussarela custam R$ 3,50 e 1 kg custa R$ 69,99. O servidor refaz esse cálculo para pedidos de clientes.
`npm run build` bloqueia a publicação se a URL HTTPS e a publishable key do Supabase não estiverem configuradas. `npm run check` executa a suíte lógica e SQL; `npm run test:ui` compila fixtures isoladas e testa os fluxos principais em Chrome, Chromium ou Edge headless.

## Modo com Supabase

Após criar um projeto de teste, aplique as migrações em `supabase/migrations/` na ordem numérica e copie `.env.example` para `.env.local` com a Project URL e a publishable key. O login principal usa e-mail e senha, com sessão persistente; Google e telefone são oferecidos conforme a configuração dos provedores. Consulte [ACESSO.md](ACESSO.md) para migrar contas que usavam link e ativar master/operadora. Jamais use uma `service_role` key no navegador. A aplicação não importa nem lê pedidos antigos do `localStorage` e mantém apenas a sacola/preferências e a sessão de autenticação no dispositivo. Pedidos, perfis e catálogo passam pelo banco. O SQL com custos da padaria fica em `private/`, ignorado pelo Git.

O modo com Supabase ainda **não está homologado com um projeto real**. Consulte [PRODUCAO.md](PRODUCAO.md) para ativação, segurança, backup, testes e pendências do piloto.

## Implementado

- Lançamento manual, ajuste, cancelamento com histórico, estados de conferência/separação/entrega, totais em centavos e lista diária consolidada de quantidades para conferência com a padaria.
- Portal de pedido, edição e cancelamento até 22h30 do dia anterior à entrega, com forma de pagamento pretendida.
- Banco com acesso por cliente/operadora, totais calculados no servidor, controle de versão para evitar sobrescrita e trilha de alterações.
- Sincronização em tempo real pelo Supabase, mantendo a consulta periódica como contingência.
- Rolagem suave com GSAP no desktop, entradas discretas das seções e transições entre telas. Em telas de toque, a rolagem permanece nativa; a opção de movimento reduzido desativa os efeitos. Menu, sacola e impressão preservam seu posicionamento.
- Modelo A4 de 27 etiquetas de 70 × 33 mm (3 × 9), com deslocamento ajustável e divisão de pedidos longos em mais de uma etiqueta; **ainda não calibrado** na impressora e folha reais.

O Pix permanece manual: o cliente pode selecionar um ou mais pedidos inteiros, e a operação confirma o recebimento somente após conferência externa. A taxa é fixa em R$ 2,00 por pedido. A tela financeira oferece períodos diário, de 7 dias, de 15 dias e intervalo personalizado; separa venda dos produtos, custo da padaria, lucro bruto e taxa de entrega. Custo incompleto impede fechar repasse/lucro, e custo estimado produz apenas lucro provisório. Retenção de dados e uma eventual integração com provedor Pix continuam pendentes. Não publique como versão oficial antes do checklist do piloto.
