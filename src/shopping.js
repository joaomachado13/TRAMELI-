import { rebuildCart, frequentProductIds } from './shopping-math.js';

export function initShopping(live) {
  const state={ready:false,favorites:new Set(),pending:new Set(),message:'',rebuildCart,frequentProductIds};
  let loading=null;
  const changed=()=>dispatchEvent(new Event('trameli:shopping-changed'));
  state.refresh=async()=>{
    if(!live || loading)return loading;
    loading=(async()=>{
      try {
        const rows=[];
        for(let from=0;;from+=500){
          const {data,error}=await live.client.from('trameli_favorites').select('product_id').eq('user_id',live.user.id).order('product_id').range(from,from+499);
          if(error)throw error;
          rows.push(...data);if(data.length<500)break;
        }
        state.favorites=new Set(rows.map(row=>row.product_id));state.ready=true;state.message='';
      } catch(error){state.ready=false;state.message=error.code==='PGRST205'?'Favoritos aguardam ativação no banco.':'Não foi possível atualizar favoritos.';}
      changed();
    })();
    try{await loading;}finally{loading=null;}
  };
  state.toggle=async id=>{
    if(!live||!state.ready||state.pending.has(id))return;
    state.pending.add(id);changed();
    const next=!state.favorites.has(id);
    try {
      const {error}=await live.client.rpc('trameli_set_favorite',{p_product_id:id,p_favorite:next});
      if(error)throw error;
      if(next)state.favorites.add(id);else state.favorites.delete(id);
      state.message='';
    }catch{state.message='Não foi possível salvar o favorito. Tente novamente.';}
    finally{state.pending.delete(id);changed();}
  };
  window.TrameliShopping=state;
  state.refresh();
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)state.refresh();});
}
