import QRCode from 'qrcode';
import { validatePixTemplate, pixForAmount } from './pix-code.js';
import { escapeHtml as esc } from './auth-utils.js';
import './manual-pix.css';

const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value/100);
export function initManualPix(live) {
  let config=null, problem='', loading=null, opening=false, expires=null, shownOrderIds=[], intentRequestId=null;
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
      intentRequestId=crypto.randomUUID();
      const payload=pixForAmount(config.payload,amount);
      const dataUrl=await QRCode.toDataURL(payload,{errorCorrectionLevel:'M',width:320,margin:4});
      // Do not reopen a dialog that the customer closed while the requests ran.
      if(!dialog.open)return;
      open(`<h2>Pix direto na conta</h2><strong class="pix-amount">${money(amount)}</strong><p>Saldo dos pedidos: ${rows.map(row=>`#${esc(row.order_id.slice(0,8))}`).join(', ')}</p><p>Titular informado pela loja: <strong>${esc(config.receiver_label)}</strong>. Antes de confirmar, confira o titular e o valor exibidos pelo seu banco. Se não corresponderem, não pague e contate a loja.</p><img class="pix-qr" src="${dataUrl}" width="320" height="320" alt="QR Code Pix para o saldo em aberto"><label>Pix Copia e Cola<textarea data-pix-payload readonly rows="4">${esc(payload)}</textarea></label><button type="button" data-pix-copy>Copiar Pix</button><p data-pix-copy-status role="status"></p><button type="button" data-pix-signal>Já paguei — avisar a operação</button><p><strong>Esse aviso não confirma o pagamento.</strong> A operação ainda precisa conferir a entrada no banco e registrar o recebimento.</p><p>Se já pagou, não pague de novo só porque o saldo continua em aberto.</p><p>Use o app do banco para ler o QR ou colar o código e autorizar a transferência. A Trameli não abre nem controla seu banco.</p><p>O código não vence no banco. Esta tela será ocultada após 5 minutos para você consultar o saldo novamente; cópias e capturas antigas continuam pagáveis.</p>`);
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
        open('<h2>Aviso enviado</h2><p>A operação recebeu seu aviso e ainda conferirá o banco. <strong>Seu pagamento ainda não está marcado como confirmado.</strong></p>');
      }catch(error){button.disabled=false;const host=dialog.querySelector('[data-pix-copy-status]');if(host)host.textContent=error.message||'Não foi possível enviar o aviso.';}
      return;
    }
    if(button.matches('[data-pix-copy]')){
      const input=dialog.querySelector('[data-pix-payload]'),status=dialog.querySelector('[data-pix-copy-status]');
      try{await navigator.clipboard.writeText(input.value);status.textContent='Pix copiado. Cole no aplicativo do banco e confira os dados.';}
      catch{input.focus();input.select();status.textContent='Não foi possível copiar automaticamente. Copie o texto selecionado.';}
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
      const {error}=await live.client.rpc('trameli_save_pix_settings',{p_payload:raw,p_receiver_label:receiver,p_enabled:enabled,p_expected_version:Number(form.dataset.version)});
      if(error)throw error;
      await refresh();open('<h2>Configuração salva</h2><p>Antes de usar com clientes, faça a leitura do QR no banco e confira titular e valor. Nenhum pagamento foi realizado pelo site.</p>');
    }catch(error){errorHost.textContent=error.message||'Não foi possível salvar.';}
    finally{delete form.dataset.busy;button.disabled=false;}
  });
  dialog.addEventListener('cancel',event=>{if(dialog.querySelector('[data-busy]'))event.preventDefault();else clearTimeout(expires);});
  window.TrameliPix={render,refresh};refresh();
}
