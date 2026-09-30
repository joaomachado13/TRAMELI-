function matchProduct(item, products) {
  if(item.productId) return products.find(product=>product.id===item.productId);
  const matches=products.filter(product=>product.name.trim().toLocaleLowerCase('pt-BR')===String(item.name).trim().toLocaleLowerCase('pt-BR'));
  return matches.length===1?matches[0]:null;
}

// Rebuild a cart; never copy stored prices, fees, status or payment data into a new order.
export function rebuildCart(order, products, feeCents=200) {
  const cart={}, notices=[];
  for(const item of order.items || []) {
    const product=matchProduct(item,products);
    if(!product?.active) {notices.push(`${item.name}: não está disponível e ficou fora da sacola.`);continue;}
    let quantity;
    if(product.unit==='kg') {
      if(item.quantity!==1||!Number.isInteger(item.weightGrams)||item.weightGrams<50||item.weightGrams%50!==0) {
        notices.push(`${product.name}: a unidade mudou ou o peso antigo não é válido; escolha o peso novamente.`);continue;
      }
      quantity=item.weightGrams/50;
      if(item.kgPriceCents!==product.priceCents)notices.push(`${product.name}: preço por kg atualizado.`);
    } else {
      if(item.weightGrams!==undefined){notices.push(`${product.name}: a unidade de venda mudou; escolha novamente.`);continue;}
      quantity=item.quantity;
      if(item.priceCents!==product.priceCents)notices.push(`${product.name}: preço atualizado.`);
    }
    if(!Number.isInteger(quantity)||quantity<1){notices.push(`${product.name}: quantidade antiga inválida.`);continue;}
    const next=(cart[product.id] || 0)+quantity;
    cart[product.id]=Math.min(99,next);
    if(next>99)notices.push(`${product.name}: quantidade ajustada ao limite atual; confira a sacola.`);
  }
  if(order.feeCents!==feeCents)notices.push('A taxa de entrega mudou e será mostrada no resumo final.');
  return {cart,notices};
}

export function frequentProductIds(orders,products,limit=6) {
  const counts=new Map();
  for(const order of orders) {
    if(order.status==='cancelled')continue;
    const ids=new Set((order.items||[]).map(item=>matchProduct(item,products)).filter(product=>product?.active).map(product=>product.id));
    ids.forEach(id=>counts.set(id,(counts.get(id)||0)+1));
  }
  return [...counts].filter(([,count])=>count>=2).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,limit).map(([id])=>id);
}
