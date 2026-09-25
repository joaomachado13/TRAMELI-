import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const enabled = Boolean(url && key && !url.includes('YOUR_PROJECT') && !key.includes('YOUR_PUBLISHABLE_KEY'));

const mapOrder = row => ({
  id: row.id, createdAt: row.created_at, updatedAt: row.updated_at, version: row.version,
  status: row.status, checked: row.status !== 'received',
  customerId: row.customer_id, source: row.source,
  customer: row.customer_name, phone: row.phone, address: row.address,
  date: row.delivery_date, notes: row.notes, items: row.items,
  feeCents: row.fee_cents, subtotalCents: row.subtotal_cents, totalCents: row.total_cents,
});
const mapProduct = (row, cost) => ({
  id: row.id, name: row.name, category: row.category, unit: row.unit,
  image: row.image_url, priceCents: row.price_cents, active: row.active,
  sourceRow: row.source_row, reviewReason: row.review_reason,
  costCents: cost?.unit_cost_cents ?? null, supplierName: cost?.supplier_name || '',
  costEstimated: Boolean(cost?.estimated),
});

export class LiveData {
  constructor() {
    this.client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    this.orders = [];
    this.products = [];
    this.profile = null;
    this.user = null;
    this.operator = false;
    this.loadingPromise = null;
    this.lastOrderSync = null;
    this.costSummaryCache = new Map();
    this.catalogUpgradeReady = false;
  }

  async preflight() {
    const { error } = await this.client.from('trameli_products').select('id').limit(1);
    if (!error) return { ready: true };
    if (error.code === 'PGRST205') return { ready: false, reason: 'schema_missing' };
    throw error;
  }

  async authenticate() {
    const { data, error } = await this.client.auth.getUser();
    if (error && error.name !== 'AuthSessionMissingError') throw error;
    this.user = data?.user || null;
    if (!this.user) return false;
    const role = await this.client.rpc('trameli_is_operator');
    if (role.error) throw role.error;
    this.operator = Boolean(role.data);
    return true;
  }

  async requestLink(email) {
    const redirect = `${location.origin}${location.pathname}`;
    const { error } = await this.client.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } });
    if (error) throw error;
  }

  async load(force = false) {
    if (this.loadingPromise) {
      await this.loadingPromise;
      if (!force) return;
    }
    this.loadingPromise = (async () => {
      const productResult = await this.client.from('trameli_products').select('*').order('name');
      if (productResult.error) throw productResult.error;
      let costs = new Map();
      if (this.operator) {
        const costResult = await this.client.from('trameli_product_costs').select('*');
        if (costResult.error && costResult.error.code !== 'PGRST205') throw costResult.error;
        this.catalogUpgradeReady = !costResult.error;
        if (costResult.data) costs = new Map(costResult.data.map(row => [row.product_id, row]));
      }
      const nextProducts = productResult.data.map(row => mapProduct(row, costs.get(row.id)));
      const changedOrders = [];
      for (let from = 0; ; from += 500) {
        let query = this.client.from('trameli_orders').select('*')
          .order('updated_at', { ascending: true }).order('id', { ascending: true }).range(from, from + 499);
        if (this.lastOrderSync) query = query.gte('updated_at', this.lastOrderSync);
        const result = await query;
        if (result.error) throw result.error;
        changedOrders.push(...result.data.map(mapOrder));
        if (result.data.length < 500) break;
      }
      const profileResult = await this.client.from('trameli_profiles').select('*').eq('user_id', this.user.id).maybeSingle();
      if (profileResult.error) throw profileResult.error;
      this.products = nextProducts;
      const merged = new Map(this.orders.map(order => [order.id, order]));
      changedOrders.forEach(order => merged.set(order.id, order));
      this.orders = [...merged.values()];
      if (changedOrders.length) this.lastOrderSync = changedOrders.at(-1).updatedAt;
      this.profile = profileResult.data;
      if (changedOrders.length) this.costSummaryCache.clear();
      dispatchEvent(new Event('trameli:catalog-changed'));
      dispatchEvent(new Event('trameli:orders-changed'));
    })();
    try { await this.loadingPromise; }
    finally { this.loadingPromise = null; }
  }

  async saveProduct(product) {
    if (!this.catalogUpgradeReady && product.costCents != null) {
      throw new Error('Aplique a migração do catálogo e custos antes de cadastrar custo da padaria.');
    }
    const args = {
      p_id: product.id || null, p_name: product.name, p_category: product.category,
      p_unit: product.unit, p_image_url: product.image || null,
      p_price_cents: product.priceCents, p_active: product.active,
    };
    const { error } = await this.client.rpc(this.catalogUpgradeReady ? 'trameli_save_product_full' : 'trameli_save_product',
      this.catalogUpgradeReady ? { ...args, p_cost_cents: product.costCents ?? null, p_supplier_name: product.supplierName || '' } : args);
    if (error) throw error;
    this.costSummaryCache.clear();
    await this.load(true);
  }

  async confirmProductCost(productId) {
    if (!this.operator) throw new Error('Acesso restrito à operação.');
    const { error } = await this.client.rpc('trameli_confirm_product_cost', { p_product_id: productId });
    if (error) throw error;
    this.costSummaryCache.clear();
    await this.load(true);
  }

  async saveOperatorOrder(order, requestId) {
    const { error } = await this.client.rpc('trameli_operator_order', {
      p_order_id: order.id || null, p_expected_version: order.version || null,
      p_request_id: requestId,
      p_delivery_date: order.date, p_name: order.customer, p_phone: order.phone,
      p_address: order.address, p_notes: order.notes,
      p_fee_cents: order.feeCents, p_items: order.items,
    });
    if (error) throw error;
    await this.load(true);
  }

  async setStatus(order, status) {
    const { error } = await this.client.rpc('trameli_operator_status', {
      p_order_id: order.id, p_expected_version: order.version, p_status: status,
    });
    if (error) throw error;
    await this.load(true);
  }

  async saveCustomerOrder(order, lines, requestId) {
    const { data, error } = await this.client.rpc('trameli_customer_order', {
      p_order_id: order.id || null, p_expected_version: order.version || null,
      p_request_id: requestId,
      p_delivery_date: order.date, p_name: order.customer,
      p_phone: order.phone, p_address: order.address, p_notes: order.notes,
      p_lines: lines,
    });
    if (error) throw error;
    await this.load(true);
    return this.orders.find(item => item.id === data);
  }

  async cancelCustomerOrder(order) {
    const { error } = await this.client.rpc('trameli_cancel_customer_order', {
      p_order_id: order.id, p_expected_version: order.version,
    });
    if (error) throw error;
    await this.load(true);
  }

  async orderEvents(orderId) {
    const { data, error } = await this.client.from('trameli_order_events')
      .select('happened_at,actor_id,before_state,after_state')
      .eq('order_id', orderId).order('happened_at', { ascending: false }).limit(100);
    if (error) throw error;
    return data;
  }

  async costSummary(from = null, to = null) {
    if (!this.operator) throw new Error('Acesso restrito à operação.');
    if (!this.catalogUpgradeReady) throw new Error('Aplique a migração de custos para consultar o repasse.');
    const key = `${from || ''}:${to || ''}`;
    const cached = this.costSummaryCache.get(key);
    if (cached && Date.now() - cached.at < 30000) return cached.rows;
    const rows = [];
    for (let start = 0; ; start += 500) {
      const { data, error } = await this.client.rpc('trameli_order_cost_summary', {
        p_from: from, p_to: to,
      }).range(start, start + 499);
      if (error) throw error;
      rows.push(...data);
      if (data.length < 500) break;
    }
    this.costSummaryCache.set(key, { at: Date.now(), rows });
    return rows;
  }
}
