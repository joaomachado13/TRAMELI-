# Identificadores de migrations

As migrations de recorrência e bloqueio de horário foram alinhadas, em 20/10/2026, às versões já aplicadas no projeto `rwxwcyerhqcprarjptak`, consultadas por `list_migrations`. O SQL foi preservado. As duas migrations antes identificadas como `202610190022` agora usam versões únicas do histórico real. Os arquivos dependentes do mesmo conjunto também foram alinhados para preservar sua ordem de aplicação.

| Identificador antigo no repositório | Identificador aplicado no banco | Migration |
| --- | --- | --- |
| `202610180017` | `20261018172627` | customer_billing_frequency |
| `202610190020` | `20261018183146` | recurring_operator_orders |
| `202610190021` | `20261018184606` | recurring_future_balance_guard |
| `202610190022` | `20261018192431` | store_hours_and_operator_customer_profile |
| `202610190023` | `20261018194059` | delete_recurring_schedule_with_orders |
| `202610190030` | `20261018203008` | fix_delete_recurring_generated_order |
| `202610190031` | `20261018213719` | recurring_payable_eve |
| `202610190022` | `20261018235457` | recurring_weekdays_and_requests |
| `202610200032` | `20261020115055` | order_deduplication_and_edit_flags |

Essa correção é local ao histórico versionado: não reaplique esses SQLs nem modifique o histórico remoto para usar os números antigos. Ela não cria novas alterações no banco.

As migrations mais antigas também possuem diferenças legadas entre os nomes locais e os registros remotos. Antes de automatizar `db push`, confira o histórico completo com `supabase migration list` e reconcilie essas diferenças; a remoção do identificador duplicado não substitui essa conferência. O fluxo de publicação do site não aplica migrations.

`tests/migration.test.mjs` verifica a unicidade dos identificadores e a ordem das dependências desse conjunto, além das consultas de integração em banco isolado.
