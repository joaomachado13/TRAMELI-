// Restricted reusable static BR Code profile. Never fetch URLs or infer a recipient.
export function crc16(text) {
  let crc=0xffff;
  for(const byte of new TextEncoder().encode(text)) {
    crc ^= byte << 8;
    for(let bit=0;bit<8;bit++) crc=((crc&0x8000)?(crc<<1)^0x1021:crc<<1)&0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4,'0');
}
export function fields(text) {
  const result=new Map();
  for(let pos=0;pos<text.length;) {
    const header=text.slice(pos,pos+4);
    if(!/^\d{4}$/.test(header))throw new Error('Pix Copia e Cola incompleto ou inválido.');
    const id=header.slice(0,2),length=Number(header.slice(2));
    if(!length||result.has(id)||pos+4+length>text.length)throw new Error('Campos do Pix inválidos.');
    result.set(id,text.slice(pos+4,pos+4+length));pos+=4+length;
  }
  return result;
}
const tlv=(id,value)=>id+String(value.length).padStart(2,'0')+value;
export function validatePixTemplate(raw) {
  const code=String(raw||'').trim();
  if(code.length<80||code.length>512||!/^[\x20-\x7e]+$/.test(code))throw new Error('Use um Pix Copia e Cola estático do banco, sem quebras de linha ou caracteres especiais.');
  const root=fields(code), allowed=new Set(['00','01','26','52','53','58','59','60','62','63']);
  if(root.has('54'))throw new Error('Gere no banco um código reutilizável SEM valor fixo. O site preencherá o saldo de cada pedido.');
  if([...root.keys()].some(id=>!allowed.has(id))||root.get('00')!=='01'||(root.has('01')&&root.get('01')!=='11')||root.get('53')!=='986'||root.get('58')!=='BR'||!/^\d{4}$/.test(root.get('52')||''))throw new Error('Use apenas Pix estático simples, sem saque, gorjeta, recorrência ou link dinâmico.');
  if(!/6304[0-9A-F]{4}$/.test(code)||crc16(code.slice(0,-4))!==root.get('63'))throw new Error('O código Pix falhou na verificação de integridade. Copie novamente do banco.');
  const account=fields(root.get('26')||''), extra=fields(root.get('62')||'');
  if(account.get('00')?.toLowerCase()!=='br.gov.bcb.pix'||!account.get('01')||account.get('01').length>77||[...account.keys()].some(id=>!['00','01','02'].includes(id)))throw new Error('O código precisa conter uma chave Pix estática, não uma URL.');
  if(extra.size!==1||!(/^(?:\*\*\*|[a-zA-Z0-9]{1,25})$/).test(extra.get('05')||''))throw new Error('Referência Pix inválida.');
  if(!root.get('59')?.trim()||root.get('59').length>25||!root.get('60')?.trim()||root.get('60').length>15)throw new Error('Nome ou cidade do recebedor inválidos.');
  return {code,root,receiver:root.get('59'),key:account.get('01')};
}
export function pixForAmount(template,amountCents) {
  if(!Number.isSafeInteger(amountCents)||amountCents<1||amountCents>100000000)throw new Error('Saldo inválido para pagamento.');
  const {root}=validatePixTemplate(template);
  root.set('54',(amountCents/100).toFixed(2));root.delete('63');
  const payload=[...root].sort(([a],[b])=>a.localeCompare(b)).map(([id,value])=>tlv(id,value)).join('')+'6304';
  return payload+crc16(payload);
}
