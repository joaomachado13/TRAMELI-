# Acesso à Trameli

A entrada principal agora usa e-mail e senha. A sessão é restaurada quando a pessoa volta ao mesmo navegador; o link por e-mail ficou restrito à confirmação inicial exigida pelo provedor e à recuperação de senha. O aplicativo também implementa Google e telefone com senha/validação por SMS, disponíveis conforme os provedores habilitados no Supabase.

## Ativação no projeto conectado

Em 30/09/2026, o endpoint público de autenticação voltou a responder após a restauração do projeto. Configuração verificada: e-mail habilitado, confirmação de e-mail exigida, Google e telefone desabilitados. A chave pública do navegador não permite alterar essas opções nem atribuir a primeira conta master.

O titular confirmou a execução da migração 006, a atribuição da sua primeira conta master no SQL Editor e o acesso ao painel com a identificação Master. Os passos de instalação e atribuição abaixo ficam como referência para novos ambientes; não reaplique a migração já executada. A confirmação de acesso não identifica se foi usada senha ou sessão anterior; envio de e-mail, Google e SMS ainda dependem de validação dos provedores reais.

1. Abra Authentication → Users. Uma conta que antes entrava por link pode ainda não ter senha. Se estiver com sessão válida na Trameli, abra Minha conta (no portal) ou Configurações (no painel) e defina sua senha. Se não tiver sessão, use Criar ou recuperar senha; isso exige que o envio de e-mail esteja funcionando. Não crie outra conta com e-mail diferente para tentar recuperar os mesmos pedidos.
2. Para novas contas, Criar conta solicita e-mail e senha, e nome/endereço são preenchidos no pedido. Quando a confirmação de e-mail estiver ativa, confirme uma vez antes de entrar. O cadastro não dispensa essa exigência do Supabase. Configure SMTP para envio a clientes externos; o código não altera essa proteção.
3. No SQL Editor, execute `supabase/migrations/202609300006_access_roles.sql`. Ela depende somente da migração inicial e mantém as operadoras existentes. Não modifica produtos ou pedidos. As outras migrações continuam pendentes conforme PRODUCAO.md.
4. Escolha explicitamente uma conta já cadastrada para ser a primeira master. Execute o SQL abaixo substituindo SOMENTE o endereço pelo e-mail confirmado do titular. O bloco falha se a conta não existir ou não tiver o e-mail confirmado; não concede permissão à primeira pessoa que entrar.

```sql
do $$
declare selected_user uuid;
begin
  select id into selected_user from auth.users
  where lower(email) = lower('SEU_EMAIL_CONFIRMADO') and email_confirmed_at is not null;
  if selected_user is null then
    raise exception 'Crie/identifique e confirme a conta correta antes de atribuir master.';
  end if;
  insert into public.trameli_operators(user_id, role)
  values (selected_user, 'master')
  on conflict (user_id) do update set role = excluded.role;
end;
$$;
```

5. Reabra a Trameli. A conta master terá Equipe e acessos em Configurações. Ela pode atribuir operadora/master ou retirar o acesso da equipe de uma conta já cadastrada. As senhas dessas pessoas não passam pela master. Acesso administrativo nunca é escolhido no formulário público de cadastro.

## Google

No Google Auth Platform, configure um cliente OAuth do tipo Web. Cadastre as origens usadas pelo site e o callback `https://rwxwcyerhqcprarjptak.supabase.co/auth/v1/callback`. Em Supabase → Authentication → Sign In / Providers → Google, habilite o provedor e salve Client ID e Client Secret. O secret fica no Supabase, nunca em variável VITE, código ou Git.

Em Authentication → URL Configuration, autorize `http://127.0.0.1:4173/` e `http://127.0.0.1:4173/?auth=recovery` para o teste local e os equivalentes HTTPS da publicação quando existir. O código envia a origem/caminho atual ao iniciar OAuth. Respeite o público autorizado na configuração Google enquanto o aplicativo estiver em teste. A tela consulta a configuração pública do Supabase para disponibilizar o botão; nome e e-mail vêm do Google, endereço continua sendo dado de entrega a preencher.

## Telefone

Authentication → Sign In / Providers → Phone precisa de provedor SMS configurado. O aplicativo aceita número brasileiro com DDD, normaliza para +55, cadastra telefone e senha e pede o código SMS quando exigido. Entradas seguintes usam telefone e senha. Recuperação por telefone usa código SMS sem criar conta nova. Enquanto o provedor estiver desligado, a interface não oferece essa escolha. Não se usa telefone como atalho para acessar conta alheia, nem SMS fictício.

## Sessão e permissões

- Cliente abre o portal; operadora e master podem acessar a operação. Somente master gerencia equipe.
- A migração guarda o papel na tabela protegida, sem confiar em nome, e-mail digitado, localStorage ou metadados editáveis pelo cliente para conceder privilégios.
- Sair encerra a sessão neste navegador e limpa a sacola local. Nunca armazenamos senha em localStorage.
- Trocas de papel são conferidas durante a sincronização; as regras no banco se aplicam imediatamente às novas solicitações.
- Mudanças de acesso são auditadas. Não é permitido alterar a própria permissão pela tela de equipe.

## Verificação

`npm run check` inclui testes de credenciais e recuperação, permissões reais em PostgreSQL local, bloqueio de promoção pelo cliente/operadora, revogação e auditoria. Google/SMS e envio de confirmação/recuperação precisam de teste com os provedores reais depois da configuração. A presença do botão não comprova que credenciais externas foram ativadas.

Há também o teste de interface `tests/auth-ui.mjs`, executado contra o Vite com `TRAMELI_TEST_URL=http://127.0.0.1:4173/`. Ele usa navegador temporário e respostas simuladas em `tests/auth-fixture.html`, cobre sessão persistente, senha inválida/correta, recuperação, Google habilitado/desabilitado, confirmação por telefone, falha ao carregar os dados e larguras de 390/1280 px. A fixture não é uma entrada do build de publicação e não concede acesso à aplicação real. `TRAMELI_CHECK_REAL_LOGIN=1` acrescenta leitura da tela real de login, sem credenciais nem envio de mensagens.

Documentação de referência: [senha](https://supabase.com/docs/guides/auth/passwords), [Google](https://supabase.com/docs/guides/auth/social-login/auth-google) e [recuperação](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail).
