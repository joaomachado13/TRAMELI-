# Ensaio de restauração do backup

Este procedimento é obrigatório antes de chamar o backup de validado. Ele deve ser executado somente em um projeto Supabase descartável, nunca no projeto de produção `rwxwcyerhqcprarjptak`.

## Pré-requisitos

- Um projeto Supabase novo, vazio e com outro `project_ref`.
- A connection string do **Session pooler** desse projeto e a senha do banco.
- `age` e `psql` instalados em um computador confiável.
- Os seis arquivos `.sql.age`, o manifesto/`SHA256SUMS` e a identidade privada `age` correspondente.

Não coloque connection strings, senhas ou a chave privada em Git, issue, log público ou conversa. Use uma pasta temporária com acesso restrito.

## Procedimento

1. Compare os SHA-256 dos seis arquivos criptografados com o manifesto. Interrompa se houver qualquer diferença.
2. Confirme visualmente que a URL de destino **não contém** `rwxwcyerhqcprarjptak`.
3. Decripte `roles`, `schema`, `auth-data`, `data`, `history-schema` e `history-data` na pasta temporária.
4. No projeto descartável, habilite previamente as extensões não padrão encontradas no projeto de origem.
5. Restaure em uma única transação, parando no primeiro erro:

```powershell
psql --single-transaction --variable ON_ERROR_STOP=1 `
  --file roles.sql `
  --file schema.sql `
  --command "SET session_replication_role = replica" `
  --file auth-data.sql `
  --file data.sql `
  --file history-schema.sql `
  --file history-data.sql `
  --dbname "CONNECTION_STRING_DO_PROJETO_DESCARTAVEL"
```

6. Confira no destino: quantidade de usuários, 14 tabelas `trameli_%`, 81 produtos, vínculos entre usuários/perfis/pedidos, RLS habilitada e histórico de migrations.
7. Use duas contas de cliente e uma de operadora para provar isolamento de pedidos, catálogo, criação/edição/cancelamento, pagamento manual e fechamento diário.
8. Registre data, responsável, duração, resultado e qualquer ajuste manual. Só então habilite agendamento do backup.
9. Apague com segurança os SQLs decriptados. O conjunto criptografado continua no destino externo conforme a retenção aprovada.

Configurações de Auth/SMTP/OAuth, chaves JWT, objetos de Storage, domínio e redirects não são recuperados apenas pelo dump SQL e precisam de checklist separado.

Referência oficial: [Backup and Restore using the Supabase CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
