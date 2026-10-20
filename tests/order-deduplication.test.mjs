import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20261020115055_order_deduplication_and_edit_flags.sql', import.meta.url), 'utf8');
const liveData = await readFile(new URL('../src/live-data.js', import.meta.url), 'utf8');
const portal = await readFile(new URL('../assets/portal.js', import.meta.url), 'utf8');
const operation = await readFile(new URL('../assets/operacao.js', import.meta.url), 'utf8');
const operationCss = await readFile(new URL('../assets/operacao.css', import.meta.url), 'utf8');
const portalCss = await readFile(new URL('../assets/portal.css', import.meta.url), 'utf8');

assert.match(migration, /add column if not exists edited_at timestamptz/i);
assert.match(migration, /Você já tem um pedido para essa data/i);
assert.match(migration, /Este cliente já tem um pedido para essa data/i);
assert.match(migration, /status = 'received', edited_at = now\(\)/);
assert.match(migration, /edited_at = case when p_status = 'confirmed' then null else edited_at end/);
assert.match(migration, /and delivery_date = p_delivery_date and status <> 'cancelled'[\s\S]*?continue;/);
assert.match(liveData, /editedAt: row\.edited_at \|\| null/);
assert.match(portal, /Abra Meus pedidos e escolha Alterar/);
assert.match(portal, /order\.editedAt \? '<span class="order-edited-badge"/);
assert.match(operation, /Este cliente já tem um pedido para essa data/);
assert.match(operation, /order\.editedAt \? '<span class="order-edited-badge"/);
assert.match(operationCss, /\.order-edited-badge[^{]*\{[^}]*background:#fef3c7[^}]*color:#78350f/s);
assert.match(portalCss, /\.order-edited-badge[^{]*\{[^}]*background:#fef3c7[^}]*color:#78350f/s);

console.log('Order deduplication and edited-order marker checks passed.');
