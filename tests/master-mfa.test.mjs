import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const db = new PGlite({ extensions: { pgcrypto } });
const examplePix = '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D';

try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users(id uuid primary key, email text, phone text);

    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;

    create function auth.jwt() returns jsonb language sql stable as $
      select jsonb_build_object(
        'sub', nullif(current_setting('request.jwt.claim.sub', true), ''),
        'aal', coalesce(nullif(current_setting('request.jwt.claim.aal', true), ''), 'aal1'),
        'amr', case
          when nullif(current_setting('request.jwt.claim.totp_ts', true), '') is null then '[]'::jsonb
          else jsonb_build_array(jsonb_build_object(
            'method', 'totp',
            'timestamp', current_setting('request.jwt.claim.totp_ts', true)::bigint
          ))
        end
      );
    $;

    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    grant execute on function auth.jwt() to authenticated;
  `);

  for (const file of [
    '202609240001_initial.sql',
    '202609300006_access_roles.sql',
    '202609300009_manual_pix.sql',
  ]) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  }

  // Minimal representatives of the Master RPCs introduced by migration 010.
  // The MFA migration wraps these exact signatures and keeps the original logic private.
  await db.exec(`
    create function public.trameli_save_settings(
      text,text,text,text,text,time,time,integer
    ) returns void language plpgsql security definer set search_path='' as $$
    begin
      if not public.trameli_is_master() then raise exception 'Apenas Master.' using errcode='42501'; end if;
    end $$;

    create function public.trameli_master_delete_order(uuid)
    returns void language plpgsql security definer set search_path='' as $$
    begin
      if not public.trameli_is_master() then raise exception 'Apenas Master.' using errcode='42501'; end if;
    end $$;

    create function public.trameli_master_delete_product(uuid)
    returns void language plpgsql security definer set search_path='' as $$
    begin
      if not public.trameli_is_master() then raise exception 'Apenas Master.' using errcode='42501'; end if;
    end $$;

    create function public.trameli_master_purge_test_orders()
    returns integer language plpgsql security definer set search_path='' as $$
    begin
      if not public.trameli_is_master() then raise exception 'Apenas Master.' using errcode='42501'; end if;
      return 7;
    end $$;

    revoke all on function public.trameli_save_settings(text,text,text,text,text,time,time,integer) from public, anon;
    revoke all on function public.trameli_master_delete_order(uuid) from public, anon;
    revoke all on function public.trameli_master_delete_product(uuid) from public, anon;
    revoke all on function public.trameli_master_purge_test_orders() from public, anon;
    grant execute on function public.trameli_save_settings(text,text,text,text,text,time,time,integer) to authenticated;
    grant execute on function public.trameli_master_delete_order(uuid) to authenticated;
    grant execute on function public.trameli_master_delete_product(uuid) to authenticated;
    grant execute on function public.trameli_master_purge_test_orders() to authenticated;
  `);

  await db.exec(await readFile(new URL('../supabase/migrations/202610050011_master_mfa_hardening.sql', import.meta.url), 'utf8'));

  const master = randomUUID();
  const operator = randomUUID();
  const customer = randomUUID();

  await db.query(
    'insert into auth.users(id,email) values($1,$2),($3,$4),($5,$6)',
    [master, 'master@example.test', operator, 'operator@example.test', customer, 'customer@example.test'],
  );
  await db.query(
    "insert into public.trameli_operators(user_id,role) values($1,'master'),($2,'operator')",
    [master, operator],
  );

  const assume = async (userId, aal = 'aal1', totpTimestamp = null) => {
    await db.exec('reset role; set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
    await db.query("select set_config('request.jwt.claim.aal',$1,false)", [aal]);
    await db.query("select set_config('request.jwt.claim.totp_ts',$1,false)", [
      totpTimestamp == null ? '' : String(totpTimestamp),
    ]);
  };
  const nowSeconds = () => Math.floor(Date.now() / 1000);

  const savePix = version => db.query(
    'select public.trameli_save_pix_settings($1,$2,true,$3)',
    [examplePix, 'Titular de teste', version],
  );

  await assume(customer, 'aal2', nowSeconds());
  await assert.rejects(savePix(0), /Master/);

  await assume(operator, 'aal2', nowSeconds());
  await assert.rejects(savePix(0), /Master/);

  await assume(master, 'aal1');
  await assert.rejects(savePix(0), /duas etapas/);

  await assume(master, 'aal2', nowSeconds() - 601);
  await assert.rejects(savePix(0), /novamente o código/);
  await assert.rejects(
    db.query("select public.trameli_set_team_role('customer@example.test','operator')"),
    /duas etapas/,
  );
  await assert.rejects(
    db.query("select public.trameli_save_settings('Trameli','', '#244d32','#b6c780','#f5f1e8','13:30','22:30',200)"),
    /duas etapas/,
  );
  await assert.rejects(db.query('select public.trameli_master_purge_test_orders()'), /duas etapas/);

  // Internal pre-MFA implementations must not be callable by browser roles.
  await assert.rejects(
    db.query('select public.trameli_save_pix_settings_unchecked($1,$2,true,0)', [examplePix, 'Titular de teste']),
    /permission denied/,
  );
  await assert.rejects(
    db.query("select public.trameli_set_team_role_unchecked('customer@example.test','operator')"),
    /permission denied/,
  );
  await assert.rejects(db.query('select public.trameli_require_master_aal2()'), /permission denied/);

  await assume(master, 'aal2', nowSeconds());
  await savePix(0);
  assert.equal((await db.query('select count(*)::int n from public.trameli_pix_settings_events')).rows[0].n, 1);

  await db.query("select public.trameli_set_team_role('customer@example.test','operator')");
  await db.query("select public.trameli_save_settings('Trameli','', '#244d32','#b6c780','#f5f1e8','13:30','22:30',200)");
  assert.equal((await db.query('select public.trameli_master_purge_test_orders() as n')).rows[0].n, 7);

  await assume(customer, 'aal2', nowSeconds());
  assert.equal((await db.query('select public.trameli_access_role() as role')).rows[0].role, 'operator');

  console.log('MFA Master: ações críticas exigem Master + AAL2 + TOTP confirmado nos últimos 10 minutos.');
} finally {
  await db.close();
}
