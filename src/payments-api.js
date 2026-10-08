export class PaymentsApi {
  constructor(live) {
    this.live = live; this.ready = null; this.error = ''; this.pending = null;
    this.balances = []; this.statement = []; this.payments = []; this.allocations = []; this.intents = []; this.receipts = []; this.profiles = [];
    this.snapshot = '';
  }
  async rows(factory, sort) {
    const rows = [];
    for (let from = 0; ; from += 500) {
      let query = factory();
      for (const column of sort) query = query.order(column);
      const { data, error } = await query.range(from, from + 499);
      if (error) throw error;
      rows.push(...data);
      if (data.length < 500) return rows;
    }
  }
  async load(force = false) {
    if (this.pending) { await this.pending; if (!force) return; }
    this.pending = (async () => {
      try {
        const c = this.live.client;
        const balances = await this.rows(() => c.rpc('trameli_payment_balances'), ['order_id']);
        const statement = await this.rows(() => c.rpc('trameli_payment_statement'), ['payment_id', 'order_id']);
        const payments = this.live.operator ? await this.rows(() => c.from('trameli_payments').select('id,kind,amount_cents,method,reference,note,reverses_id,recorded_at'), ['id']) : [];
        const allocations = this.live.operator ? await this.rows(() => c.from('trameli_payment_allocations').select('payment_id,order_id,amount_cents'), ['payment_id', 'order_id']) : [];
        const intentResult = await c.from('trameli_payment_intents').select('id,customer_id,order_ids,amount_cents,status,created_at,resolved_at').order('created_at',{ascending:false}).limit(500);
        if (intentResult.error && intentResult.error.code !== 'PGRST205') throw intentResult.error;
        const intents = intentResult.error ? [] : intentResult.data;
        let receipts = [];
        let profiles = [];
        if (this.live.operator) {
          profiles = await this.rows(
            () => c.from('trameli_profiles').select('user_id,name,phone,address,order_blocked,order_blocked_at,order_block_reason'),
            ['user_id']
          );
          const receiptResult = await c.from('trameli_payment_receipts')
            .select('id,intent_id,customer_id,storage_path,file_name,mime_type,created_at')
            .order('created_at',{ascending:false}).limit(500);
          if (receiptResult.error && receiptResult.error.code !== 'PGRST205') throw receiptResult.error;
          receipts = receiptResult.error ? [] : receiptResult.data;
        }
        const snapshot = JSON.stringify({ balances, statement, payments, allocations, intents, receipts, profiles });
        const changed = snapshot !== this.snapshot || this.ready !== true;
        this.snapshot = snapshot;
        Object.assign(this, { balances, statement, payments, allocations, intents, receipts, profiles, ready: true, error: '' });
        if (changed) window.dispatchEvent(new Event('trameli:payments-changed'));
      } catch (error) {
        this.ready = ['PGRST202', 'PGRST205'].includes(error.code) ? false : this.ready;
        this.error = this.ready === false ? 'Falta ativar a migração 007 de pagamentos no Supabase.' : 'Não foi possível atualizar os pagamentos. Tente novamente antes de registrar valores.';
        window.dispatchEvent(new Event('trameli:payments-changed'));
      }
    })();
    try { await this.pending; } finally { this.pending = null; }
  }
  async call(name, args) {
    const { data, error } = await this.live.client.rpc(name, args);
    if (error) throw error;
    return data;
  }
}
