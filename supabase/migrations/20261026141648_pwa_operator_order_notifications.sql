-- Final order-event notification mapping, including operator-created customer orders.
create or replace function public.trameli_queue_order_event(p_order_id uuid,p_event text)
returns uuid
language plpgsql security definer set search_path to ''
as $$
declare
  v_user uuid:=auth.uid(); v_order public.trameli_orders%rowtype; v_operator boolean;
  v_id uuid; v_title text; v_body text; v_url text; v_dedupe text; v_recipient uuid;
begin
  if v_user is null then raise exception 'login required' using errcode='42501'; end if;
  select * into v_order from public.trameli_orders where id=p_order_id;
  if not found then raise exception 'order not found' using errcode='P0002'; end if;
  v_operator:=public.trameli_is_operator();

  if p_event in ('new_order','order_edited','order_cancelled') then
    if not v_operator and v_order.customer_id is distinct from v_user then
      raise exception 'order access required' using errcode='42501';
    end if;
  elsif p_event in ('operator_order_created','status_confirmed','status_ready','status_delivered','status_cancelled') then
    if not v_operator then raise exception 'operator access required' using errcode='42501'; end if;
  else raise exception 'invalid notification event' using errcode='22023'; end if;

  v_dedupe:='order:'||v_order.id::text||':'||p_event||':v'||v_order.version::text;

  case p_event
    when 'new_order' then
      v_title:='Novo pedido recebido'; v_body:=v_order.customer_name||' · entrega '||to_char(v_order.delivery_date,'DD/MM');
      v_url:='/?open-order='||v_order.id::text||'#operacao';
    when 'order_cancelled' then
      v_title:='Pedido cancelado'; v_body:=v_order.customer_name||' cancelou o pedido de '||to_char(v_order.delivery_date,'DD/MM')||'.';
      v_url:='/?open-order='||v_order.id::text||'#operacao';
    when 'operator_order_created' then
      v_title:='Novo pedido no Pão Doce 🍞'; v_body:='A Shirley registrou um pedido para '||to_char(v_order.delivery_date,'DD/MM')||'. Confira os itens.';
      v_url:='/?portal=orders#loja'; v_recipient:=v_order.customer_id;
    when 'order_edited' then
      if v_operator then
        v_title:='Seu pedido foi atualizado'; v_body:='A operação atualizou seu pedido de '||to_char(v_order.delivery_date,'DD/MM')||'.';
        v_url:='/?portal=orders#loja'; v_recipient:=v_order.customer_id;
      else
        v_title:='Pedido alterado pelo cliente'; v_body:=v_order.customer_name||' atualizou o pedido de '||to_char(v_order.delivery_date,'DD/MM')||'.';
        v_url:='/?open-order='||v_order.id::text||'#operacao';
      end if;
    when 'status_confirmed' then
      v_title:='Pedido confirmado 🍞'; v_body:='Seu pedido de '||to_char(v_order.delivery_date,'DD/MM')||' foi conferido.';
      v_url:='/?portal=orders#loja'; v_recipient:=v_order.customer_id;
    when 'status_ready' then
      v_title:='Pedido pronto'; v_body:='Seu pedido de '||to_char(v_order.delivery_date,'DD/MM')||' está pronto para a entrega.';
      v_url:='/?portal=orders#loja'; v_recipient:=v_order.customer_id;
    when 'status_delivered' then
      v_title:='Pedido entregue'; v_body:='Seu pedido de '||to_char(v_order.delivery_date,'DD/MM')||' foi marcado como entregue.';
      v_url:='/?portal=orders#loja'; v_recipient:=v_order.customer_id;
    else
      v_title:='Pedido cancelado'; v_body:='Seu pedido de '||to_char(v_order.delivery_date,'DD/MM')||' foi cancelado pela operação.';
      v_url:='/?portal=orders#loja'; v_recipient:=v_order.customer_id;
  end case;

  insert into public.trameli_notifications(created_by,kind,title,body,url,audience,metadata,dedupe_key)
  values(v_user,'system',v_title,v_body,v_url,'system',
    jsonb_build_object('orderId',v_order.id,'event',p_event,'orderCode',v_order.public_code),v_dedupe)
  on conflict(dedupe_key) do nothing returning id into v_id;

  if v_id is null then
    select id into v_id from public.trameli_notifications where dedupe_key=v_dedupe;
    return v_id;
  end if;

  if v_recipient is not null then
    insert into public.trameli_notification_recipients(notification_id,user_id)
    values(v_id,v_recipient) on conflict do nothing;
  else
    insert into public.trameli_notification_recipients(notification_id,user_id)
    select v_id,user_id from public.trameli_operators on conflict do nothing;
  end if;

  update public.trameli_notifications n
    set target_count=(select count(*) from public.trameli_notification_recipients r where r.notification_id=n.id),
        status=case when exists(select 1 from public.trameli_notification_recipients r where r.notification_id=n.id)
          then 'queued' else 'failed' end,
        updated_at=now()
  where n.id=v_id;
  return v_id;
end $$;

revoke all on function public.trameli_queue_order_event(uuid,text) from public;
grant execute on function public.trameli_queue_order_event(uuid,text) to authenticated;
