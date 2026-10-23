import { createClient } from '@supabase/supabase-js';
import { AuthService } from './auth-service.js';
import { resolveProductPhoto } from './product-photos.js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
// A suíte de UI deve ser isolada: nunca autentique nem consulte o Supabase durante os testes.
export const enabled = import.meta.env.MODE !== 'test' && Boolean(url && key && !url.includes('YOUR_PROJECT') && !key.includes('YOUR_PUBLISHABLE_KEY'));

const mapOrder = row => ({
  id: row.id, publicCode: row.public_code || '', createdAt: row.created_at, updatedAt: row.updated_at, editedAt: row.edited_at || null, editedBy: row.edited_by || null, version: row.version,
  status: row.status, checked: row.status !== 'received',
  customerId: row.customer_id, source: row.source,
  customer: row.customer_name, phone: row.phone, address: row.address,
  date: row.delivery_date, notes: row.notes, items: row.items,
  paymentMethod: row.payment_method_preference || 'unspecified',
  feeCents: row.fee_cents, subtotalCents: row.subtotal_cents, totalCents: row.total_cents,
});
const mapProduct = (row, cost) => ({
  id: row.id, name: row.name, category: row.category, unit: row.unit,
  image: resolveProductPhoto(row.id, row.image_url), priceCents: row.price_cents, active: row.active,
  sourceRow: row.source_row, reviewReason: row.review_reason,
  costCents: cost?.unit_cost_cents ?? null, supplierName: cost?.supplier_name || '',
  bakerySupplier: row.bakery_supplier || 'divano',
  costEstimated: Boolean(cost?.estimated),
  unavailableFrom: row.unavailable_from || null, unavailableUntil: row.unavailable_until || null,
  substituteProductId: row.substitute_product_id || null,
  featuredPosition: row.featured_position ?? null,
});

export class LiveData {
  constructor() {
    this.client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    this.auth = new AuthService(this.client, url, key);
    this.recovery = new URLSearchParams(location.search).get('auth') === 'recovery'
      || new URLSearchParams(location.hash.slice(1)).get('type') === 'recovery';
    this.client.auth.onAuthStateChange(event => {
      if (event === 'PASSWORD_RECOVERY') this.recovery = true;
    });
    this.orders = [];
    this.products = [];
    this.settings = null;
    this.commercialTerms = { deliveryFeeCents: 200, productPrices: new Map() };
    this.purchaseStatus = { blocked: false, kind: 'clear', reason: '', dueCents: 0 };
    this.profile = null;
    this.user = null;
    this.operator = false;
    this.role = 'customer';
    this.rolesReady = false;
    this.loadingPromise = null;
    this.lastOrderSync = null;
    this.costSummaryCache = new Map();
    this.catalogUpgradeReady = false;
    this.realtimeChannel = null;
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
    const role = await this.client.rpc('trameli_access_role');
    if (role.error && role.error.code !== 'PGRST202') throw role.error;
    this.rolesReady = !role.error;
    if (this.rolesReady) this.role = role.data;
    else {
      const legacy = await this.client.rpc('trameli_is_operator');
      if (legacy.error) throw legacy.error;
      this.role = legacy.data ? 'operator' : 'customer';
    }
    this.operator = ['operator', 'master'].includes(this.role);
    return true;
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
      const settingsResult = await this.client.from('trameli_settings').select('*').eq('singleton', true).maybeSingle();
      if (settingsResult.error && settingsResult.error.code !== 'PGRST205') throw settingsResult.error;
      const commercialTerms = {
        deliveryFeeCents: Number(settingsResult.data?.delivery_fee_cents ?? 200),
        productPrices: new Map(),
      };
      if (!this.operator && this.user?.id) {
        const [termsResult, priceResult] = await Promise.all([
          this.client.from('trameli_customer_terms').select('delivery_fee_cents').eq('customer_id', this.user.id).maybeSingle(),
          this.client.from('trameli_customer_product_prices').select('product_id,price_cents').eq('customer_id', this.user.id),
        ]);
        if (termsResult.error && termsResult.error.code !== 'PGRST205') throw termsResult.error;
        if (priceResult.error && priceResult.error.code !== 'PGRST205') throw priceResult.error;
        const negotiatedFee = Number(termsResult.data?.delivery_fee_cents);
        if (Number.isSafeInteger(negotiatedFee) && negotiatedFee >= 0) commercialTerms.deliveryFeeCents = negotiatedFee;
        for (const row of priceResult.data || []) {
          const price = Number(row.price_cents);
          if (row.product_id && Number.isSafeInteger(price) && price >= 0) commercialTerms.productPrices.set(row.product_id, price);
        }
      }
      const nextProducts = productResult.data.map(row => {
        const product = mapProduct(row, costs.get(row.id));
        const negotiated = commercialTerms.productPrices.get(row.id);
        return negotiated == null ? product : { ...product, priceCents: negotiated };
      });
      const changedOrders = [];
      for (let from = 0; ; from += 500) {
        let query = this.client.from('trameli_orders').select('*')
          .order('updated_at', { ascending: true }).order('id', { ascending: true }).range(from, from + 499);
        if (this.lastOrderSync && !force) query = query.gte('updated_at', this.lastOrderSync);
        const result = await query;
        if (result.error) throw result.error;
        changedOrders.push(...result.data.map(mapOrder));
        if (result.data.length < 500) break;
      }
      const profileResult = await this.client.from('trameli_profiles').select('*').eq('user_id', this.user.id).maybeSingle();
      if (profileResult.error) throw profileResult.error;
      let purchaseStatus = { blocked: false, kind: 'clear', reason: '', dueCents: 0 };
      if (!this.operator) {
        const statusResult = await this.client.rpc('trameli_customer_purchase_status');
        if (statusResult.error && statusResult.error.code !== 'PGRST202') throw statusResult.error;
        if (statusResult.data) purchaseStatus = statusResult.data;
      }
      const productSignature = value => JSON.stringify((value || []).map(item => ({
        id:item.id,name:item.name,category:item.category,unit:item.unit,image:item.image,
        priceCents:item.priceCents,active:item.active,costCents:item.costCents,
        supplierName:item.supplierName,bakerySupplier:item.bakerySupplier,costEstimated:item.costEstimated,
        unavailableFrom:item.unavailableFrom,unavailableUntil:item.unavailableUntil,
        substituteProductId:item.substituteProductId,
        featuredPosition:item.featuredPosition,
      })));
      const settingsSignature = value => JSON.stringify(value || null);
      const productsChanged = productSignature(this.products) !== productSignature(nextProducts);
      const settingsChanged = settingsSignature(this.settings) !== settingsSignature(settingsResult.data);

      const previousOrders = this.orders;
      const merged = force ? new Map() : new Map(previousOrders.map(order => [order.id, order]));
      const actualOrderChanges = changedOrders.filter(order => {
        const previous = merged.get(order.id);
        return !previous || previous.version !== order.version || previous.updatedAt !== order.updatedAt;
      });
      actualOrderChanges.forEach(order => merged.set(order.id, order));
      const nextOrders = force ? changedOrders : [...merged.values()];
      const orderSignature = value => JSON.stringify((value || []).map(order => [order.id,order.version,order.updatedAt]).sort((a,b)=>a[0].localeCompare(b[0])));
      const ordersChanged = force
        ? orderSignature(previousOrders) !== orderSignature(nextOrders)
        : actualOrderChanges.length > 0;

      this.products = nextProducts;
      this.settings = settingsResult.data;
      this.commercialTerms = commercialTerms;
      this.purchaseStatus = purchaseStatus;
      this.orders = nextOrders;
      if (changedOrders.length) this.lastOrderSync = changedOrders.at(-1).updatedAt;
      else if (force) this.lastOrderSync = null;
      this.profile = profileResult.data;

      if (ordersChanged) this.costSummaryCache.clear();
      if (settingsChanged) window.dispatchEvent(new Event('trameli:settings-changed'));
      if (productsChanged) dispatchEvent(new Event('trameli:catalog-changed'));
      if (ordersChanged) dispatchEvent(new Event('trameli:orders-changed'));
    })();
    try { await this.loadingPromise; }
    finally { this.loadingPromise = null; }
  }

  async refreshPurchaseStatus() {
    if (this.operator || !this.user?.id) {
      this.purchaseStatus = { blocked: false, kind: 'clear', reason: '', dueCents: 0 };
      return this.purchaseStatus;
    }
    const { data, error } = await this.client.rpc('trameli_customer_purchase_status');
    if (error?.code === 'PGRST202') return this.purchaseStatus;
    if (error) throw error;
    this.purchaseStatus = data || { blocked: false, kind: 'clear', reason: '', dueCents: 0 };
    window.dispatchEvent(new Event('trameli:purchase-status-changed'));
    return this.purchaseStatus;
  }

  async setProductFeatured(productId, position) {
    if (!this.operator) throw new Error('Apenas a operação pode escolher os destaques.');
    const { error } = await this.client.rpc('trameli_set_product_featured', {
      p_product_id: productId, p_position: position,
    });
    if (error?.code === 'PGRST202') throw new Error('A vitrine ainda precisa ser ativada pela administração.');
    if (error) throw error;
    await this.load(true);
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
    const operationalArgs = { ...args, p_cost_cents: product.costCents ?? null,
      p_supplier_name: product.supplierName || '', p_bakery_supplier: product.bakerySupplier || 'divano',
      p_unavailable_from: product.unavailableFrom || null,
      p_unavailable_until: product.unavailableUntil || null,
      p_substitute_product_id: product.substituteProductId || null };
    let result = await this.client.rpc('trameli_save_product_operational', operationalArgs);
    if (result.error?.code === 'PGRST202') result = await this.client.rpc(
      this.catalogUpgradeReady ? 'trameli_save_product_full' : 'trameli_save_product',
      this.catalogUpgradeReady ? { ...args, p_cost_cents: product.costCents ?? null, p_supplier_name: product.supplierName || '' } : args);
    const { data, error } = result;
    if (error) throw error;
    // The RPC returns the canonical database UUID. Keep it even if the refreshed
    // catalog cache is momentarily stale or filtered by a concurrent refresh.
    const savedId = data || product.id || null;
    this.costSummaryCache.clear();
    await this.load(true);
    return this.products.find(item => item.id === savedId)
      || { ...product, id: savedId };
  }

  async confirmProductCost(productId) {
    if (!this.operator) throw new Error('Acesso restrito à operação.');
    const { error } = await this.client.rpc('trameli_confirm_product_cost', { p_product_id: productId });
    if (error) throw error;
    this.costSummaryCache.clear();
    await this.load(true);
  }

  async saveOperatorOrder(order, requestId, customerId) {
    const { error } = await this.client.rpc('trameli_operator_order_for_customer', {
      p_order_id: order.id || null, p_expected_version: order.version || null,
      p_request_id: requestId,
      p_delivery_date: order.date, p_name: order.customer, p_phone: order.phone,
      p_address: order.address, p_notes: order.notes,
      p_fee_cents: order.feeCents, p_items: order.items, p_customer_id: customerId,
    });
    if (error) throw error;
    await this.load(true);
  }

  async customerCommercialTerms(customerId) {
    if (!this.operator) throw new Error('Acesso restrito à operação.');
    if (!customerId) throw new Error('Selecione um cliente existente.');
    const [termsResult, priceResult] = await Promise.all([
      this.client.from('trameli_customer_terms').select('delivery_fee_cents').eq('customer_id', customerId).maybeSingle(),
      this.client.from('trameli_customer_product_prices').select('product_id,price_cents').eq('customer_id', customerId),
    ]);
    if (termsResult.error) throw termsResult.error;
    if (priceResult.error) throw priceResult.error;
    const result = {
      deliveryFeeCents: Number(this.settings?.delivery_fee_cents ?? 200),
      productPrices: new Map(),
    };
    const negotiatedFee = Number(termsResult.data?.delivery_fee_cents);
    if (Number.isSafeInteger(negotiatedFee) && negotiatedFee >= 0) result.deliveryFeeCents = negotiatedFee;
    for (const row of priceResult.data || []) {
      const price = Number(row.price_cents);
      if (row.product_id && Number.isSafeInteger(price) && price >= 0) result.productPrices.set(row.product_id, price);
    }
    return result;
  }

  async saveRecurringOrder(schedule, requestId, scheduleId = null) {
    if (!this.operator) throw new Error('Acesso restrito à operação.');
    const weekdays = [...new Set((schedule.weekdays || [1, 2, 3, 4, 5, 6]).map(Number))].sort((a, b) => a - b);
    const daily = schedule.itemsByWeekday !== undefined;
    const { data, error } = await this.client.rpc(daily ? 'trameli_save_recurring_order_daily' : 'trameli_save_recurring_order_with_days', {
      p_schedule_id: scheduleId, p_request_id: requestId,
      p_customer_id: schedule.customerId, p_recurrence: schedule.recurrence,
      p_start_date: schedule.startDate, p_active: true, p_notes: schedule.notes,
      p_fee_cents: schedule.feeCents, p_items: schedule.items, p_weekdays: weekdays,
      ...(daily ? { p_items_by_weekday: schedule.itemsByWeekday } : {}),
    });
    if (error?.code === 'PGRST202' && daily) throw new Error('A opção de produtos por dia ainda precisa ser ativada no banco.');
    if (error) throw error;
    return data;
  }

  async recurringRequests() {
    if (!this.operator) throw new Error('Acesso restrito à operação.');
    const { data, error } = await this.client.from('trameli_recurring_requests')
      .select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async reviewRecurringRequest(requestId, approve) {
    if (!this.operator) throw new Error('Acesso restrito à operação.');
    const { data, error } = await this.client.rpc('trameli_review_recurring_request', {
      p_request_id: requestId, p_approve: Boolean(approve),
    });
    if (error) throw error;
    await this.load(true);
    return data;
  }

  async requestRecurringOrder(orderId, weekdays) {
    if (!this.user?.id || !orderId) throw new Error('Entre na sua conta para solicitar a recorrência.');
    const days = [...new Set((weekdays || []).map(Number))].sort((a, b) => a - b);
    if (!days.length) throw new Error('Selecione pelo menos um dia da semana.');
    const { data, error } = await this.client.rpc('trameli_request_recurring_order', {
      p_order_id: orderId, p_weekdays: days,
    });
    if (error) throw error;
    return data;
  }

  async materializeRecurringOrders(date) {
    const { data, error } = await this.client.rpc('trameli_materialize_recurring_orders', {
      p_delivery_date: date,
    });
    if (error) throw error;
    await this.load(true);
    return Number(data || 0);
  }

  async recurringSchedules() {
    if (!this.operator) throw new Error('Acesso restrito à operação.');
    const { data, error } = await this.client.from('trameli_recurring_orders').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async setRecurringScheduleActive(scheduleId, active) {
    if (!this.operator) throw new Error('Acesso restrito à operação.');
    const { error } = await this.client.rpc('trameli_set_recurring_order_active', {
      p_schedule_id: scheduleId, p_active: active,
    });
    if (error) throw error;
  }

  async deleteRecurringSchedule(scheduleId) {
    if (!this.operator) throw new Error('Acesso restrito à operação.');
    if (!scheduleId) throw new Error('Selecione uma programação.');
    const { data, error } = await this.client.rpc('trameli_delete_recurring_order', {
      p_schedule_id: scheduleId,
    });
    if (error) throw error;
    await this.load(true);
    return Number(data || 0);
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
      p_payment_method: order.paymentMethod,
      p_lines: lines,
    });
    if (error) throw error;
    if (!data) throw new Error('O servidor não confirmou o registro do pedido. Nenhuma confirmação foi exibida.');

    // A confirmação da RPC significa que o pedido já foi gravado. Uma falha
    // na atualização do cache não deve transformar a gravação em erro no checkout.
    let refreshError = null;
    try { await this.load(true); }
    catch (cause) { refreshError = cause; }

    const saved = this.orders.find(item => item.id === data);
    if (saved) return saved;

    const fallback = {
      ...order,
      id: data || order.id,
      publicCode: order.publicCode || '',
      status: order.status || 'received',
      source: order.source || 'portal',
      items: order.items || [],
    };
    if (refreshError) console.warn('Pedido registrado; atualização da lista será repetida depois.', refreshError.code || refreshError.name);
    return fallback;
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

  async uploadProductImage(productId, file) {
    if (this.role !== 'master') throw new Error('Apenas Master pode enviar fotos de produtos.');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2097152) {
      throw new Error('Use PNG, JPEG ou WebP de até 2 MB.');
    }
    const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
    const path = `${productId}/${crypto.randomUUID()}.${extension}`;
    const { error } = await this.client.storage.from('trameli-products').upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw error;
    return this.client.storage.from('trameli-products').getPublicUrl(path).data.publicUrl;
  }

  async saveSettings(settings) {
    if (this.role !== 'master') throw new Error('Apenas Master pode alterar as configurações.');
    const { error } = await this.client.rpc('trameli_save_settings', {
      p_business_name: settings.businessName, p_contact: settings.contact,
      p_primary_color: settings.primaryColor, p_accent_color: settings.accentColor,
      p_surface_color: settings.surfaceColor, p_rollover_time: settings.rolloverTime,
      p_cutoff_time: settings.cutoffTime, p_delivery_fee_cents: settings.deliveryFeeCents,
    });
    if (error) throw error;
    await this.load(true);
  }

  async saveProfile(profile) {
    const { error } = await this.client.rpc('trameli_save_profile', {
      p_name: profile.name, p_phone: profile.phone, p_address: profile.address,
    });
    if (error) throw error;
    this.profile = { ...(this.profile || {}), ...profile };
    window.dispatchEvent(new Event('trameli:profile-changed'));
  }

  async updateCustomerProfile(profile) {
    if (!this.operator) throw new Error('Acesso restrito à operação.');
    if (!profile?.id) throw new Error('Selecione um cliente existente.');
    const { error } = await this.client.rpc('trameli_operator_update_customer_profile', {
      p_customer_id: profile.id,
      p_name: profile.name,
      p_phone: profile.phone || '',
      p_address: profile.address,
    });
    if (error) throw error;
    window.dispatchEvent(new Event('trameli:payments-refresh'));
  }

  // paymentMode: 'none' recusa se houver pagamento vinculado; 'keep' mantém o pagamento; 'delete' exclui pedido e pagamento.
  async deleteOrder(orderId, paymentMode = 'none') {
    if (this.role !== 'master') throw new Error('Apenas Master pode excluir pedidos definitivamente.');
    let { error } = await this.client.rpc('trameli_master_delete_order_with_payments', { p_order_id: orderId, p_payment_mode: paymentMode });
    if (error?.code === 'PGRST202') {
      if (paymentMode !== 'none') throw new Error('Aplique a migração 202610160018 para excluir pedidos com pagamento vinculado.');
      ({ error } = await this.client.rpc('trameli_master_delete_order', { p_order_id: orderId }));
    }
    if (error) throw error;
    this.orders = this.orders.filter(order => order.id !== orderId);
    this.costSummaryCache.clear();
    dispatchEvent(new Event('trameli:orders-changed'));
  }

  async deleteProduct(productId) {
    if (this.role !== 'master') throw new Error('Apenas Master pode excluir produtos definitivamente.');
    const { error } = await this.client.rpc('trameli_master_delete_product', { p_product_id: productId });
    if (error) throw error;
    await this.load(true);
  }

  async purgeTestOrders() {
    if (this.role !== 'master') throw new Error('Apenas Master pode limpar a base de pedidos.');
    const { data, error } = await this.client.rpc('trameli_master_purge_test_orders');
    if (error) throw error;
    this.orders = [];
    this.lastOrderSync = null;
    this.costSummaryCache.clear();
    dispatchEvent(new Event('trameli:orders-changed'));
    return Number(data || 0);
  }

  async productEvents(productId) {
    if (!this.operator) throw new Error('Acesso restrito à operação.');
    const { data, error } = await this.client.from('trameli_product_events')
      .select('id,event_kind,happened_at,before_state,after_state')
      .eq('product_id', productId).order('happened_at', { ascending: false }).limit(100);
    if (error) throw error;
    return data;
  }

  startRealtime() {
    if (this.realtimeChannel) return;
    let refreshTimer;
    const changed = payload => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => this.load(true).catch(() => {}), 150);
      window.dispatchEvent(new CustomEvent('trameli:remote-change', { detail: payload }));
    };
    this.realtimeChannel = this.client.channel(`trameli-live-${this.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trameli_orders' }, changed)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trameli_products' }, changed)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trameli_settings' }, changed)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trameli_payment_intents' }, payload => {
        window.dispatchEvent(new CustomEvent('trameli:remote-change', { detail: payload }));
        window.dispatchEvent(new Event('trameli:payments-refresh'));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trameli_payments' }, payload => {
        changed(payload);
        window.dispatchEvent(new Event('trameli:payments-refresh'));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trameli_payment_allocations' }, payload => {
        changed(payload);
        window.dispatchEvent(new Event('trameli:payments-refresh'));
      }).subscribe();
  }

  // Linhas de custo gravadas por pedido (somente operação). Usadas no repasse da padaria.
  async orderCostRows(orderIds) {
    if (!this.operator) throw new Error('Acesso restrito à operação.');
    if (!this.catalogUpgradeReady) throw new Error('Aplique a migração de custos para consultar o repasse.');
    const ids = [...new Set(orderIds)];
    const rows = [];
    for (let start = 0; start < ids.length; start += 100) {
      const { data, error } = await this.client.from('trameli_order_costs')
        .select('order_id,line_index,quantity,unit_cost_cents,total_cost_cents,estimated')
        .in('order_id', ids.slice(start, start + 100));
      if (error) throw error;
      rows.push(...data);
    }
    return rows;
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
