import QRCode from 'qrcode';
import { validatePixTemplate, pixForAmount } from './pix-code.js';
import { escapeHtml as esc } from './auth-utils.js';
import './manual-pix.css';

const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value/100);
const whatsappIcon='<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M13.601 2.326A7.854 7.854 0 0 0 7.994.001C3.627.001.068 3.558.064 7.926c0 1.399.366 2.76 1.057 3.965L0 16l4.204-1.102a7.933 7.933 0 0 0 3.79.965h.004c4.368 0 7.926-3.558 7.93-7.93a7.898 7.898 0 0 0-2.327-5.607zm-5.607 12.2a6.598 6.598 0 0 1-3.356-.92l-.24-.143-2.494.654.666-2.433-.156-.25a6.56 6.56 0 0 1-1.007-3.505c.002-3.633 2.958-6.588 6.591-6.588 1.76 0 3.415.686 4.656 1.93a6.565 6.565 0 0 1 1.928 4.66c-.002 3.633-2.958 6.59-6.588 6.59zm3.615-4.934c-.198-.1-1.17-.578-1.352-.644-.182-.066-.314-.1-.446.1-.132.198-.512.644-.628.776-.116.132-.231.149-.43.05-.198-.1-.836-.308-1.592-.984-.588-.524-.985-1.17-1.1-1.369-.116-.198-.012-.305.087-.404.089-.088.198-.231.297-.347.1-.116.132-.198.198-.33.066-.132.033-.248-.017-.347-.05-.1-.446-1.075-.611-1.47-.16-.387-.323-.334-.446-.34l-.38-.007a.729.729 0 0 0-.528.248c-.182.198-.694.677-.694 1.65s.71 1.914.809 2.046c.099.132 1.396 2.132 3.383 2.99.473.204.842.326 1.13.417.475.151.907.13 1.249.079.381-.057 1.17-.479 1.336-.94.165-.462.165-.858.116-.94-.05-.083-.182-.132-.38-.231z"/></svg>';
const whatsappNumber=value=>{
  let digits=String(value||'').replace(/\D/g,'').replace(/^0+/,'');
  if(digits.length===10||digits.length===11)digits='55'+digits;
  return /^55\d{10,11}$/.test(digits)?digits:'';
};
export function initManualPix(live) {
  let config=null, problem='', loading=null, opening=false, expires=null, shownOrderIds=[], shownAmount=0, intentRequestId=null, shownWhatsappHref='';
  const dialog=document.createElement('dialog');dialog.className='payment-dialog pix-dialog';
  dialog.setAttribute('aria-label','Pix manual');document.body.append(dialog);
  function adminBody() {
    return `<h2>Pix direto na conta · confirmação manual</h2><p>Sem intermediador. As tarifas da conta recebedora dependem do banco. Gerar QR não confirma pagamento.</p>${problem?`<p role="status">${esc(problem)}</p>`:`<p>${config?.enabled?'Ativado':'Desativado'} · ${esc(config?.receiver_label||'Titular ainda não cadastrado')}</p>`}<button type="button" data-pix-config ${problem||!config?'disabled':''}>Configurar Pix (Master)</button><button type="button" data-pix-refresh>Atualizar configuração</button>`;
  }
  const render=()=>live?.role==='master'?`<section class="screen-panel payment-panel" data-pix-admin>${adminBody()}</section>`:'';
  function repaint(){document.querySelectorAll('[data-pix-admin]').forEach(host=>host.innerHTML=adminBody());}
  async function refresh() {
    if(!live)return;
    if(loading)return loading;
    loading=(async()=>{
      try{
        const {data,error}=await live.client.from('trameli_pix_settings').select('enabled,payload,receiver_label,version').eq('id',true).maybeSingle();
        if(error)throw error;
        config=data;problem='';
      }catch(error){config=null;problem=error.code==='PGRST205'?'Falta ativar a migração 009 do Pix manual.':'Não foi possível consultar o Pix. Tente novamente.';}
      repaint();
    })();
    try{await loading;}finally{loading=null;}
  }
  function open(html){clearTimeout(expires);dialog.innerHTML=`<button type="button" data-pix-close class="payment-close" aria-label="Fechar">×</button>${html}`;if(!dialog.open)dialog.showModal();}
  const fail=message=>open(`<h2>Pix manual</h2><p role="alert">${esc(message)}</p>`);
  function configure() {
    if(live?.role!=='master'||problem||!config)return;
    open(`<h2>Configurar recebimento Pix</h2><p>Copie do banco dela um Pix estático reutilizável <strong>sem valor</strong>. A Trameli preencherá o saldo sem mudar a chave. Não cole senha, token ou credencial bancária.</p><form data-pix-form data-version="${config.version}"><label>Pix Copia e Cola do banco<textarea name="payload" maxlength="512" rows="5">${esc(config.payload||'')}</textarea></label><label>Nome completo do titular, conferido no banco<input name="receiver" maxlength="90" value="${esc(config.receiver_label||'')}"></label><label class="payment-check"><input type="checkbox" name="enabled" ${config.enabled?'checked':''}> Habilitar Pix para os clientes</label><label class="payment-check"><input type="checkbox" name="verified"> Conferi a chave e o titular no banco e autorizei usar essa conta para receber as vendas.</label><p data-pix-error role="alert"></p><button type="submit">Salvar configuração</button></form>`);
  }
  async function pay(orderId) {
    if(!live||opening)return;opening=true;
    open('<h2>Consultar saldo para Pix</h2><p>Carregando dados atuais…</p>');
    try {
      const api=window.TrameliPayments?.api;
      if(!api)throw new Error('Consulte o saldo em Meus pedidos antes de pagar.');
      await Promise.all([refresh(),api.load(true)]);
      if(problem)throw new Error(problem);
      if(!config?.enabled)throw new Error('O Pix ainda não foi habilitado pela loja. Combine o pagamento com a operadora.');
      if(api.error||!api.ready)throw new Error(api.error||'Saldo indisponível.');
      const selected=orderId==='selected'
        ? new Set([...document.querySelectorAll('[data-pix-select]:checked')].map(input=>input.dataset.pixSelect))
        : null;
      if(selected && !selected.size)throw new Error('Selecione ao menos um pedido em aberto.');
      const rows=api.balances.filter(row=>row.customer_id===live.user.id
        && (orderId==='all'||row.order_id===orderId||selected?.has(row.order_id))
        && Number(row.due_cents)>0);
      const amount=rows.reduce((total,row)=>total+Number(row.due_cents),0);
      if(!rows.length)throw new Error('Não há saldo em aberto para esses pedidos.');
      shownOrderIds=rows.map(row=>row.order_id);
      shownAmount=amount;
      intentRequestId=crypto.randomUUID();
      const payload=pixForAmount(config.payload,amount);
      const dataUrl=await QRCode.toDataURL(payload,{errorCorrectionLevel:'M',width:320,margin:4});
      const phone=whatsappNumber(live.settings?.contact);
      const orderText=rows.map(row=>`#${row.order_id.slice(0,8)}`).join(', ');
      const waMessage=`Olá! Fiz o pagamento via Pix do pedido ${orderText}, no valor de ${money(amount)}. Vou enviar o comprovante por aqui.`;
      const waHref=phone?`https://wa.me/${phone}?text=${encodeURIComponent(waMessage)}`:'';
      shownWhatsappHref=waHref;
      // Do not reopen a dialog that the customer closed while the requests ran.
      if(!dialog.open)return;
      open(`<div class="pix-flow">
        <div class="pix-flow__head"><span>PAGAMENTO VIA PIX</span><h2 class="pix-amount">${money(amount)}</h2><p>${rows.length===1?`Pedido ${orderText}`:`${rows.length} pedidos · ${orderText}`}</p></div>
        <div class="pix-flow__receiver">Recebedor: <strong>${esc(config.receiver_label)}</strong></div>
        <img class="pix-qr" src="${dataUrl}" width="320" height="320" alt="QR Code Pix para o saldo em aberto">
        <label class="pix-copy-field"><span>Pix Copia e Cola</span><textarea data-pix-payload readonly rows="3">${esc(payload)}</textarea></label>
        <button type="button" class="pix-copy-button" data-pix-copy>Copiar código Pix</button>
        <p class="pix-copy-status" data-pix-copy-status role="status"></p>
        <section class="pix-afterpay" data-pix-afterpay>
          <span class="pix-afterpay__eyebrow">DEPOIS DE PAGAR</span>
          <h3>Avise que o Pix foi feito</h3>
          <p>A Trameli não consulta o banco automaticamente. Toque abaixo para colocar seu pagamento na fila de conferência.</p>
          <button type="button" class="pix-signal-primary" data-pix-signal>Já paguei</button>
        </section>
        <p class="pix-confirm-note">O pagamento só será marcado como confirmado depois da conferência da loja. Se já pagou, não pague de novo.</p>
      </div>`);
      expires=setTimeout(()=>{if(dialog.open)fail('Consulte novamente o saldo antes de pagar. Esta tela foi ocultada, mas isso não invalida uma cópia antiga do Pix.');},300000);
    }catch(error){if(dialog.open)fail(error.message||'Não foi possível preparar o Pix.');}
    finally{opening=false;}
  }
  document.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.matches('[data-pix-close]')){if(!dialog.querySelector('[data-busy]')){dialog.close();clearTimeout(expires);}return;}
    if(button.matches('[data-pix-config]')){await refresh();configure();return;}
    if(button.matches('[data-pix-refresh]')){await refresh();return;}
    if(button.matches('[data-pix-order]')){await pay(button.dataset.pixOrder);return;}
    if(button.matches('[data-pix-signal]')){
      if(!intentRequestId||!shownOrderIds.length)return;
      button.disabled=true;
      try{
        const {error}=await live.client.rpc('trameli_signal_pix_payment',{p_request_id:intentRequestId,p_order_ids:shownOrderIds});
        if(error)throw error;
        await window.TrameliPayments?.api?.load(true);
        open(`<div class="pix-signal-success"><span class="pix-afterpay__eyebrow">AVISO ENVIADO</span><h2>Agora é com a Shirley.</h2><p>Seu pagamento entrou na fila de conferência. Ele só será marcado como pago depois que ela conferir.</p>${shownWhatsappHref?`<a class="pix-whatsapp pix-whatsapp--wide" href="${shownWhatsappHref}" target="_blank" rel="noopener noreferrer">${whatsappIcon}<span>Enviar comprovante no WhatsApp</span></a>`:''}</div>`);
      }catch(error){button.disabled=false;const host=dialog.querySelector('[data-pix-copy-status]');if(host)host.textContent=error.message||'Não foi possível enviar o aviso.';}
      return;
    }
    if(button.matches('[data-pix-copy]')){
      const input=dialog.querySelector('[data-pix-payload]'),status=dialog.querySelector('[data-pix-copy-status]');
      try{
        await navigator.clipboard.writeText(input.value);
        status.textContent='Código copiado. Faça o pagamento e depois toque em “Já paguei”.';
      }catch{
        input.focus();input.select();
        status.textContent='Selecione e copie o código. Depois de pagar, toque em “Já paguei”.';
      }
    }
  });
  dialog.addEventListener('submit',async event=>{
    const form=event.target.closest('[data-pix-form]');if(!form)return;event.preventDefault();
    if(form.dataset.busy)return;
    const errorHost=form.querySelector('[data-pix-error]'),button=form.querySelector('[type=submit]');errorHost.textContent='';
    try{
      const enabled=form.elements.enabled.checked;
      const raw=form.elements.payload.value.trim(),receiver=form.elements.receiver.value.trim();
      if(enabled){validatePixTemplate(raw);if(receiver.length<2||!form.elements.verified.checked)throw new Error('Informe o titular e marque a conferência dos dados no banco.');}
      form.dataset.busy='true';button.disabled=true;
      await window.TrameliAccount?.ensureMasterAal2?.();
      const {error}=await live.client.rpc('trameli_save_pix_settings',{p_payload:raw,p_receiver_label:receiver,p_enabled:enabled,p_expected_version:Number(form.dataset.version)});
      if(error)throw error;
      await refresh();open('<h2>Configuração salva</h2><p>Antes de usar com clientes, faça a leitura do QR no banco e confira titular e valor. Nenhum pagamento foi realizado pelo site.</p>');
    }catch(error){errorHost.textContent=error.message||'Não foi possível salvar.';}
    finally{delete form.dataset.busy;button.disabled=false;}
  });
  dialog.addEventListener('cancel',event=>{if(dialog.querySelector('[data-busy]'))event.preventDefault();else clearTimeout(expires);});
  window.TrameliPix={render,refresh};refresh();
}
