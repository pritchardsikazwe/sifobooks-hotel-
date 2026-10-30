-- SifoHotel QA hardening: cashier roles and atomic POS checkout.
alter table public.hotel_memberships drop constraint if exists hotel_memberships_role_check;
alter table public.hotel_memberships add constraint hotel_memberships_role_check
 check (role = any (array['owner','manager','receptionist','housekeeping','accountant','maintenance','viewer','pos_cashier','cashier','bar_cashier','restaurant_cashier']));

create or replace function public.hotel_pos_post_sale(
 p_hotel_id uuid,p_shift_id uuid,p_sale_type text,p_payment_method text,p_items jsonb,p_receipt_number text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user uuid:=auth.uid(); v_role text; v_item jsonb; v_inventory public.hotel_pos_inventory%rowtype;
 v_sale_id uuid; v_total numeric(12,2):=0; v_qty numeric(12,3); v_price numeric(12,2); v_line numeric(12,2); v_lines integer:=0;
begin
 if v_user is null then raise exception 'Sign in before posting a sale.'; end if;
 if p_sale_type not in ('bar','restaurant','cash_sale') then raise exception 'Invalid sale type.'; end if;
 if p_payment_method not in ('cash','card','mobile_money','bank_transfer') then raise exception 'Invalid payment method.'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Add at least one item.'; end if;
 select m.role into v_role from public.hotel_memberships m where m.hotel_id=p_hotel_id and m.user_id=v_user and m.active
 union all select 'owner' where exists(select 1 from public.hotels h where h.id=p_hotel_id and h.owner_user_id=v_user) limit 1;
 if v_role is null or v_role not in ('owner','manager','accountant','pos_cashier','cashier','bar_cashier','restaurant_cashier') then raise exception 'You do not have POS access to this hotel.'; end if;
 perform 1 from public.hotel_pos_shifts sh where sh.id=p_shift_id and sh.hotel_id=p_hotel_id and sh.cashier_id=v_user and sh.status='open' for update;
 if not found then raise exception 'Open your own cashier shift before checkout.'; end if;
 if exists(select 1 from public.hotel_pos_sales s where s.hotel_id=p_hotel_id and s.receipt_number=p_receipt_number) then raise exception 'Receipt number already exists. Refresh before retrying.'; end if;
 for v_item in select value from jsonb_array_elements(p_items) order by (value->>'inventory_item_id') loop
   if coalesce(v_item->>'inventory_item_id','') !~* '^[0-9a-f-]{36}$' then raise exception 'Invalid inventory item.'; end if;
   if coalesce(v_item->>'quantity','') !~ '^([0-9]+)([.][0-9]+)?$' then raise exception 'Invalid item quantity.'; end if;
   v_qty:=(v_item->>'quantity')::numeric; if v_qty<=0 then raise exception 'Quantity must be positive.'; end if;
   select * into v_inventory from public.hotel_pos_inventory where id=(v_item->>'inventory_item_id')::uuid and hotel_id=p_hotel_id and active for update;
   if not found then raise exception 'An item is unavailable. Refresh the menu.'; end if;
   if v_inventory.stock_quantity<v_qty then raise exception 'Insufficient stock for %.',v_inventory.name; end if;
   v_price:=v_inventory.sale_price; v_line:=round(v_qty*v_price,2); v_total:=v_total+v_line; v_lines:=v_lines+1;
 end loop;
 if v_lines>100 then raise exception 'A sale may contain at most 100 line items.'; end if;
 insert into public.hotel_pos_sales(hotel_id,shift_id,cashier_id,receipt_number,sale_type,payment_method,subtotal,total,status)
 values(p_hotel_id,p_shift_id,v_user,p_receipt_number,p_sale_type,p_payment_method,v_total,v_total,'posted') returning id into v_sale_id;
 for v_item in select value from jsonb_array_elements(p_items) order by (value->>'inventory_item_id') loop
   v_qty:=(v_item->>'quantity')::numeric;
   select * into v_inventory from public.hotel_pos_inventory where id=(v_item->>'inventory_item_id')::uuid and hotel_id=p_hotel_id and active for update;
   v_price:=v_inventory.sale_price; v_line:=round(v_qty*v_price,2);
   insert into public.hotel_pos_sale_items(hotel_id,sale_id,inventory_item_id,item_name,quantity,unit_price,line_total) values(p_hotel_id,v_sale_id,v_inventory.id,v_inventory.name,v_qty,v_price,v_line);
   update public.hotel_pos_inventory set stock_quantity=stock_quantity-v_qty,updated_at=now() where id=v_inventory.id and hotel_id=p_hotel_id;
 end loop;
 return jsonb_build_object('sale_id',v_sale_id,'receipt_number',p_receipt_number,'total',v_total,'line_count',v_lines,'status','posted');
end $$;
revoke all on function public.hotel_pos_post_sale(uuid,uuid,text,text,jsonb,text) from public,anon;
grant execute on function public.hotel_pos_post_sale(uuid,uuid,text,text,jsonb,text) to authenticated;
