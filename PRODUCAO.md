# Preparação da versão oficial

Estado atual: projeto Supabase conectado e migração inicial aplicada. Os preços reais da planilha estão preparados no código, mas **as novas migrações e os custos ainda não foram aplicados ao projeto Supabase**. Não há domínio, backup validado nem piloto concluído. Nenhuma implantação pública foi feita.

## Catálogo recebido em 24/09/2026

- `DADOS PADARIA.xlsx` trouxe 81 linhas de produtos com preço ao cliente e a taxa de entrega de R$ 2,00 em linha separada. A aba do fornecedor contém os custos; eles **não estão no Git**.
- Após as confirmações de 25/09/2026, o catálogo preparado tem 79 itens disponíveis e 2 linhas antigas duplicadas indisponíveis. Mussarela (R$ 69,99/kg), Presunto (R$ 40,00/kg), Mortadela defumada (R$ 40,00/kg) e Peito de peru (R$ 59,99/kg) são vendidos em passos de 50 g. Pão de forma de R$ 12,00, Mini pão francês de R$ 0,70 e Manteiga Italac 200g de R$ 17,00 foram liberados; Manteiga Canto de Minas 200g permanece em R$ 17,00 e Calu 200g em R$ 19,49.
- Não usamos as 20 fotos antigas de demonstração para representar esses produtos. O portal mostra um espaço neutro até chegarem fotos correspondentes.
- `supabase/migrations/202609240002_catalog_finance.sql` cria custos privados, histórico de custo por item no pedido e consulta de cobertura. `supabase/migrations/202609240003_catalog_seed.sql` cadastra apenas preços de venda. `private/supplier-cost-import.sql` contém 43 correspondências únicas por nome normalizado da aba da padaria, está ignorado pelo Git e **deve ser revisado antes de aplicar**. Itens sem associação ficam com custo pendente, nunca com custo presumido de zero. Em outro computador, gere esse arquivo novamente com `python scripts/build-supplier-import.py "CAMINHO/DADOS PADARIA.xlsx"` (requer `openpyxl`).
- A tela financeira mostra três valores: produtos cobrados dos clientes, custo da padaria e lucro bruto dos produtos (diferença). A taxa de entrega de R$ 2,00 é informada à parte e não entra no lucro. Custo parcial impede fechar o lucro; custo estimado gera somente **lucro provisório**. Não é lucro líquido nem comprovante de pagamento/repasse.
- A aba `Meu lucro` de `DADOS PADARIA (1).xlsx` é referência histórica, não fonte automática de custos: há diferenças em relação aos preços confirmados atuais. Para Mussarela, `Meu lucro!B24` sugere R$ 26,25 de margem; supondo margem por kg, R$ 69,99 − R$ 26,25 = **R$ 43,74/kg de custo estimado**. O SQL privado `private/mussarela-provisional.sql` prepara apenas essa estimativa, sem sobrescrever custo existente; revise antes de aplicar. Presunto, mortadela defumada e peito de peru continuam sem custo de compra. A operadora pode confirmar um custo estimado no catálogo após conferir com a padaria; pedidos antigos preservam o caráter estimado do registro original.

Para ativar no projeto de teste: faça uma cópia/restore verificável do banco primeiro; depois execute as migrações `...0002...`, `...0003...`, `202609250004_weighted_frios.sql` e `202609250005_provisional_costs.sql` nessa ordem no SQL Editor. Verifique o catálogo com conta de operadora e uma conta de cliente distinta. Revise os arquivos privados de custos e só então aplique seu SQL; não os cole em issue, commit ou conversa pública. Para frios, qualquer custo cadastrado deve ser o valor **por kg**. Se um pedido foi criado antes da carga de custos, seu custo histórico permanece pendente; não recalculamos retroativamente de modo silencioso.

## Verificações de segurança já automatizadas

- A migração roda em PostgreSQL local no teste `tests/migration.test.mjs`.
- O teste confirma que um cliente não vê pedido/perfil de outro, não pode gravar diretamente nas tabelas nem se tornar operador; preços enviados pelo navegador são ignorados e o banco calcula o total.
- O teste cobre idempotência do pedido, rejeição de mudança indevida de estado e registro de auditoria.
- O build de publicação falha sem URL HTTPS e publishable key configuradas. A `service_role` key nunca deve estar no front-end.
- O workflow `.github/workflows/verify.yml` roda os testes e a auditoria de dependências em pushes e pull requests, sem credenciais do banco.
- A API do projeto já confirmou leitura pública apenas do catálogo vazio e negou leitura anônima dos pedidos. Falta testar as mesmas regras **com contas reais distintas** no projeto conectado.

## 1. Ativação da base

1. Crie um projeto Supabase **de teste**. Guarde a senha do banco e qualquer `service_role` key somente no painel/gerenciador de segredos; nunca no Git ou no navegador.
2. Aplique a migração `supabase/migrations/202609240001_initial.sql` no projeto vazio. Ela cria produtos, perfis, pedidos, eventos de auditoria, políticas de acesso por linha e funções de gravação. Não aplique cegamente a um banco com dados.
3. Em **Authentication → URL Configuration**, adicione `http://127.0.0.1:4173/` às Redirect URLs para testar esta prévia local. Quando houver domínio, substitua o Site URL e adicione a URL HTTPS definitiva. O link enviado pelo aplicativo usa a origem da página aberta.
4. Em **Authentication → Providers → Email**, mantenha o login por e-mail habilitado. O SMTP padrão do Supabase é restrito a endereços autorizados da equipe; para clientes reais, configure um provedor SMTP próprio e valide a entrega dos links.
5. Faça login uma vez com o e-mail da operadora. No SQL Editor, atribua o papel com uma consulta revisada:

```sql
insert into public.trameli_operators(user_id)
select id from auth.users where email = 'EMAIL_DA_OPERADORA'
on conflict do nothing;
```

6. Configure `.env.local` com `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`. A chave é pública; a segurança depende das políticas de acesso e das funções no banco. Execute `npm run check` e `npm run dev`.
7. Cadastre **somente preços reais confirmados** no catálogo. Não migre os 20 valores ilustrativos. Teste com contas de cliente e operadora distintas.

## 2. Regras e proteção

- Cliente autenticado vê apenas os próprios pedidos; operadora vê a fila completa. Toda gravação de pedido passa por função no banco, que recalcula preços e totais. Cancelamentos permanecem no histórico e deixam de entrar nas somas e fichas.
- A sequência operacional disponível é recebido → conferido → em separação → pronto → entregue. A operadora pode corrigir estados não finalizados; entrega e cancelamento são terminais no banco. O histórico registra estado anterior/novo e quem fez a alteração.
- O retorno no mesmo aparelho usa sessão persistente do Supabase, **não identificação oculta do celular**. O link por e-mail permite voltar em outro aparelho. Proteja contas de e-mail e considere expiração/revogação de sessão e recuperação de acesso no piloto.
- Não armazene número de apartamento, telefone e histórico em logs públicos, analytics ou ferramentas de erro sem necessidade. Defina aviso de privacidade, prazo de retenção, canal de correção/exclusão e procedimento de incidente antes de abrir a clientes.
- Taxa do portal está em R$ 2,00. Exceções, horário-limite, Pix, confirmação de pagamento e fórmula de repasse ainda precisam de regra aprovada. O valor cobrado **não significa pago**.

## 3. Backup e publicação

- Escolha domínio e hospedagem estática que entregue `dist/` por HTTPS. Configure DNS, certificado, URLs de redirect do Supabase e cabeçalhos de segurança (ao menos HSTS depois de confirmar HTTPS, CSP apropriada para o domínio Supabase, `X-Content-Type-Options: nosniff`, política de referrer). Não configure isso só no front-end.
- Para produção, prefira plano com backup diário gerenciado. No plano gratuito, a rotina `scripts/backup-supabase.ps1` prepara exportações criptografadas de papéis, esquema, dados da aplicação e dados de autenticação. Ela **ainda não está agendada nem executada no projeto real**. Nunca guarde backup de clientes no Git ou em artefatos públicos. O backup só conta como concluído após cópia externa e **restauração de teste em ambiente isolado**.
- Teste comportamento quando a internet cai: não anuncie o pedido como salvo até a função retornar sucesso. O modo com Supabase não faz fila offline.
- Antes da abertura, execute uma revisão de permissões/RLS com duas contas de cliente e uma de operadora. Nenhum cliente deve consultar, editar ou cancelar pedido alheio, nem mudar preços pelo navegador. Verifique logs de acesso e política de retenção da auditoria.

### Como ativar o backup criptografado

1. Instale Supabase CLI (requer Docker para `db dump`) e `age`. Vincule a CLI ao projeto de forma interativa com `supabase login` e `supabase link --project-ref rwxwcyerhqcprarjptak`. Não coloque senha de banco, token de acesso ou chave privada age no repositório ou no chat.
2. Gere uma identidade age em local seguro (`age-keygen -o` apontando para um caminho privado fora do projeto). Guarde a **chave privada** em dois lugares seguros e independentes; use somente a **chave pública** `age1...` no comando de backup.
3. Escolha uma pasta absoluta fora deste repositório, em disco com acesso restrito. Execute:

```powershell
./scripts/backup-supabase.ps1 -Destination 'D:\Trameli\Backups' -AgeRecipient 'age1SUA_CHAVE_PUBLICA'
```

4. Copie os quatro arquivos `.age` e o `manifest.json` do mesmo identificador para outro local protegido. Compare os SHA-256 do manifesto depois da cópia. Se qualquer etapa falhar, descarte o conjunto incompleto e investigue: **manifesto ausente significa backup inválido**.
5. Antes de automatizar, decripte com `age -d -i CAMINHO_DA_CHAVE_PRIVADA -o arquivo.sql arquivo.sql.age` em uma pasta temporária protegida e restaure em **outro projeto Supabase de teste**, seguindo o guia oficial de restauração. Teste login, leitura de pedidos e integridade das referências entre `auth.users`, perfis e pedidos. Apague os SQL temporários ao fim. A restauração de autenticação pode exigir ajustes manuais no projeto de destino; não trate uma exportação bem-sucedida como recuperação comprovada.
6. Só depois defina destino off-site, periodicidade diária, retenção e alerta para falha. O arquivo local não é backup contra falha, roubo ou perda do próprio computador.

Destino escolhido: **Google Drive, sem instalar o Drive para computador no PC da empresa**. O script PowerShell acima fica apenas como alternativa manual em um computador confiável. O fluxo principal preparado é `.github/workflows/backup-drive.yml`: uma execução manual do GitHub Actions exporta o banco em um runner temporário, criptografa antes de enviar, confere os arquivos no Drive e nunca adiciona dados ao Git. **Ainda não foi ativado nem testado com credenciais reais.**

Para ativar o fluxo remoto:

1. Em um ambiente pessoal/confiável, crie a chave age e guarde a chave privada fora do GitHub e do Drive usado para o backup. O workflow recebe apenas a chave pública.
2. Configure um OAuth client próprio para o Google Drive e um remote `gdrive` no `rclone`. O client compartilhado do rclone está sendo descontinuado em 2026. Use uma pasta/conta com acesso restrito; proteja o arquivo de configuração do rclone, que contém token de acesso.
3. Em **GitHub → repositório → Settings → Secrets and variables → Actions**, cadastre `SUPABASE_DB_URL` (conexão de banco, nunca a publishable key), `BACKUP_AGE_RECIPIENT` (chave pública `age1...`) e `RCLONE_CONFIG_B64` (configuração do rclone codificada em base64). Base64 **não é criptografia**; a proteção vem do secret do GitHub. Não mande nenhum desses valores no chat. Restrinja quem pode editar workflows/branches, pois código com acesso a secrets pode exfiltrá-los.
4. Execute **Actions → Backup criptografado para Google Drive → Run workflow**. O destino é `Trameli/Backups/<data UTC>` no remote `gdrive`. Confirme no Drive pela web os quatro `.age` e o `SHA256SUMS`.
5. Restaure em um projeto Supabase descartável e confira autenticação, pedidos, totais e permissões. Só após isso adicione uma agenda diária ao workflow e um alerta de falha. Um job bem-sucedido e um hash conferido não substituem a restauração de teste.

## 4. Aceite do piloto (aproximadamente 60 pedidos/dia)

1. Em **staging**, com catálogo real de teste, crie 60 pedidos para a mesma manhã, incluindo nomes parecidos, endereços longos, dois pedidos da mesma pessoa, ajustes, cancelamentos e tentativa de edição simultânea.
2. Compare item a item os 60 totais, as taxas, o resumo diário e o extrato com uma conferência independente. Cancelados devem continuar no histórico e ficar fora das somas e da impressão.
3. Faça a operadora abrir a fila em outro dispositivo; confirme atualização em até 15 segundos, correção de conflito de versão e fluxo de conferência → separação → entrega.
4. A folha informada é de 27 etiquetas de 70 × 33 mm em A4 (grade 3 × 9). Imprima primeiro em A4 comum, em 100%, sem cabeçalho/rodapé; sobreponha à folha adesiva e ajuste o deslocamento horizontal/vertical. Confira as etiquetas das bordas e pedidos com endereço/observação longos. Valide na impressora usada pela operadora antes de usar folhas reais; outra impressora exige nova conferência.
5. Faça um piloto acompanhado pela operadora em dias reais, mantendo o WhatsApp como contingência; só desligue a rotina antiga após ela aprovar o lançamento manual, a impressão, as somas, a recuperação de acesso e a restauração de backup.

## Ainda dependemos de

- Domínio/hospedagem; provedor de e-mail; destino externo e teste de restauração para o backup.
- Custos sem correspondência e fotos dos produtos; confirmação de exceções para a taxa de entrega. As duas linhas duplicadas antigas continuam inativas.
- Impressora usada, amostra física da folha de etiquetas 70 × 33 mm e prova de alinhamento impressa.
- Regras de horário de corte, cancelamento após conferência, pagamento Pix e repasse à padaria.
