-- Inventory procurement and valuation stage. Existing POS stock is retained and extended.
alter table public.hotel_pos_inventory add column if not exists cost_price numeric(12,2) not null default 0 check (cost_price >= 0);
alter table public.hotel_pos_inventory add column if not exists reorder_level numeric(12,3) not null default 0 check (reorder_level >= 0);
create table if not exists public.hotel_suppliers (
 id uuid primary key default gen_random_uuid(), hotel_id uuid not null references public.hotels(id) on delete cascade,
 name text not null, contact_name text, phone text, email text, address text, tax_number text, notes text,
 active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(hotel_id,id)
);
create table if not exists public.hotel_purchase_orders (
 id uuid primary key default gen_random_uuid(), hotel_id uuid not null references public.hotels(id) on delete cascade,
 supplier_id uuid not null, order_number text not null, status text not null default 'draft' check(status in ('draft','ordered','part_received','received','cancelled')),
 order_date date not null default current_date, expected_date date, notes text, created_by uuid references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(hotel_id,order_number), unique(hotel_id,id),
 foreign key(hotel_id,supplier_id) references public.hotel_suppliers(hotel_id,id) on delete restrict
);
create table if not exists public.hotel_purchase_order_items (
 id uuid primary key default gen_random_uuid(), hotel_id uuid not null references public.hotels(id) on delete cascade,
 purchase_order_id uuid not null, inventory_item_id uuid not null, item_name text not null,
 quantity_ordered numeric(12,3) not null check(quantity_ordered>0), quantity_received numeric(12,3) not null default 0 check(quantity_received>=0),
 unit_cost numeric(12,2) not null check(unit_cost>=0), created_at timestamptz not null default now(),
 foreign key(hotel_id,purchase_order_id) references public.hotel_purchase_orders(hotel_id,id) on delete cascade,
 foreign key(inventory_item_id) references public.hotel_pos_inventory(id) on delete restrict,
 check(quantity_received<=quantity_ordered)
);
create table if not exists public.hotel_goods_receipts (
 id uuid primary key default gen_random_uuid(), hotel_id uuid not null references public.hotels(id) on delete cascade,
 purchase_order_id uuid not null, receipt_number text not null, supplier_delivery_note text, received_by uuid references auth.users(id),
 received_at timestamptz not null default now(), notes text, created_at timestamptz not null default now(),
 unique(hotel_id,receipt_number), unique(hotel_id,id),
 foreign key(hotel_id,purchase_order_id) references public.hotel_purchase_orders(hotel_id,id) on delete restrict
);
create table if not exists public.hotel_goods_receipt_items (
 id uuid primary key default gen_random_uuid(), hotel_id uuid not null references public.hotels(id) on delete cascade,
 goods_receipt_id uuid not null, purchase_order_item_id uuid not null, inventory_item_id uuid not null,
 quantity_received numeric(12,3) not null check(quantity_received>0), unit_cost numeric(12,2) not null check(unit_cost>=0),
 created_at timestamptz not null default now(),
 foreign key(hotel_id,goods_receipt_id) references public.hotel_goods_receipts(hotel_id,id) on delete cascade,
 foreign key(purchase_order_item_id) references public.hotel_purchase_order_items(id) on delete restrict,
 foreign key(inventory_item_id) references public.hotel_pos_inventory(id) on delete restrict
);
create table if not exists public.hotel_stock_movements (
 id uuid primary key default gen_random_uuid(), hotel_id uuid not null references public.hotels(id) on delete cascade,
 inventory_item_id uuid not null, movement_type text not null check(movement_type in ('opening','pos_sale','goods_received','stock_count','adjustment','waste','return')),
 quantity_delta numeric(12,3) not null, unit_cost numeric(12,2) not null default 0, reference_type text, reference_id uuid, notes text,
 created_by uuid references auth.users(id), created_at timestamptz not null default now(),
 foreign key(inventory_item_id) references public.hotel_pos_inventory(id) on delete restrict
);
create table if not exists public.hotel_stock_counts (
 id uuid primary key default gen_random_uuid(), hotel_id uuid not null references public.hotels(id) on delete cascade,
 count_number text not null, status text not null default 'draft' check(status in ('draft','posted','cancelled')),
 counted_at timestamptz not null default now(), notes text, created_by uuid references auth.users(id),
 posted_at timestamptz, unique(hotel_id,count_number), unique(hotel_id,id)
);
create table if not exists public.hotel_stock_count_items (
 id uuid primary key default gen_random_uuid(), hotel_id uuid not null references public.hotels(id) on delete cascade,
 stock_count_id uuid not null, inventory_item_id uuid not null, expected_quantity numeric(12,3) not null,
 counted_quantity numeric(12,3) not null check(counted_quantity>=0), unit_cost numeric(12,2) not null default 0,
 foreign key(hotel_id,stock_count_id) references public.hotel_stock_counts(hotel_id,id) on delete cascade,
 foreign key(inventory_item_id) references public.hotel_pos_inventory(id) on delete restrict,
 unique(stock_count_id,inventory_item_id)
);
create index if not exists hotel_stock_movements_item_date_idx on public.hotel_stock_movements(hotel_id,inventory_item_id,created_at desc);
create index if not exists hotel_purchase_orders_status_idx on public.hotel_purchase_orders(hotel_id,status,order_date desc);
do $$ declare t text; begin
 foreach t in array array['hotel_suppliers','hotel_purchase_orders','hotel_purchase_order_items','hotel_goods_receipts','hotel_goods_receipt_items','hotel_stock_movements','hotel_stock_counts','hotel_stock_count_items'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy %I on public.%I for all to authenticated using (exists(select 1 from public.hotel_memberships hm where hm.hotel_id=%I.hotel_id and hm.user_id=(select auth.uid()) and hm.active) or exists(select 1 from public.hotels h where h.id=%I.hotel_id and h.owner_user_id=(select auth.uid()))) with check (exists(select 1 from public.hotel_memberships hm where hm.hotel_id=%I.hotel_id and hm.user_id=(select auth.uid()) and hm.active) or exists(select 1 from public.hotels h where h.id=%I.hotel_id and h.owner_user_id=(select auth.uid())))',t||'_tenant_all',t,t,t,t,t);
 end loop;
end $$;
-- Atomic receipt: stock, weighted-average cost, receipt records, and movements commit together.
create or replace function public.hotel_receive_purchase_order(p_hotel_id uuid,p_purchase_order_id uuid,p_receipt_number text,p_delivery_note text,p_lines jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_user uuid:=auth.uid(); v_role text; v_po public.hotel_purchase_orders%rowtype; v_line jsonb; v_item public.hotel_purchase_order_items%rowtype; v_stock public.hotel_pos_inventory%rowtype; v_qty numeric(12,3); v_cost numeric(12,2); v_receipt uuid; v_total numeric:=0; v_received numeric;
begin
 if v_user is null then raise exception 'Sign in before receiving stock.'; end if;
 select m.role into v_role from public.hotel_memberships m where m.hotel_id=p_hotel_id and m.user_id=v_user and m.active
 union all select 'owner' where exists(select 1 from public.hotels h where h.id=p_hotel_id and h.owner_user_id=v_user) limit 1;
 if v_role is null or v_role not in ('owner','manager','accountant') then raise exception 'Only an owner, manager or accountant may receive stock.'; end if;
 select * into v_po from public.hotel_purchase_orders where id=p_purchase_order_id and hotel_id=p_hotel_id for update;
 if not found or v_po.status not in ('ordered','part_received') then raise exception 'Purchase order must be ordered or partially received.'; end if;
 if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'Add received quantities.'; end if;
 if exists(select 1 from public.hotel_goods_receipts where hotel_id=p_hotel_id and receipt_number=p_receipt_number) then raise exception 'Receipt number already exists.'; end if;
 insert into public.hotel_goods_receipts(hotel_id,purchase_order_id,receipt_number,supplier_delivery_note,received_by,notes) values(p_hotel_id,p_purchase_order_id,p_receipt_number,nullif(p_delivery_note,''),v_user,'Goods received against purchase order '||v_po.order_number) returning id into v_receipt;
 for v_line in select value from jsonb_array_elements(p_lines) loop
  select * into v_item from public.hotel_purchase_order_items where id=(v_line->>'purchase_order_item_id')::uuid and hotel_id=p_hotel_id and purchase_order_id=p_purchase_order_id for update;
  if not found then raise exception 'Purchase order line is invalid.'; end if;
  v_qty:=(v_line->>'quantity_received')::numeric;
  if v_qty<=0 or v_item.quantity_received+v_qty>v_item.quantity_ordered then raise exception 'Received quantity must be positive and cannot exceed the outstanding order quantity.'; end if;
  v_cost:=coalesce((v_line->>'unit_cost')::numeric,v_item.unit_cost);
  select * into v_stock from public.hotel_pos_inventory where id=v_item.inventory_item_id and hotel_id=p_hotel_id for update;
  if not found then raise exception 'POS inventory item no longer exists.'; end if;
  insert into public.hotel_goods_receipt_items(hotel_id,goods_receipt_id,purchase_order_item_id,inventory_item_id,quantity_received,unit_cost) values(p_hotel_id,v_receipt,v_item.id,v_stock.id,v_qty,v_cost);
  update public.hotel_pos_inventory set stock_quantity=stock_quantity+v_qty,cost_price=case when stock_quantity+v_qty>0 then round(((stock_quantity*cost_price)+(v_qty*v_cost))/(stock_quantity+v_qty),2) else v_cost end,updated_at=now() where id=v_stock.id;
  insert into public.hotel_stock_movements(hotel_id,inventory_item_id,movement_type,quantity_delta,unit_cost,reference_type,reference_id,notes,created_by) values(p_hotel_id,v_stock.id,'goods_received',v_qty,v_cost,'goods_receipt',v_receipt,'Received against PO '||v_po.order_number,v_user);
  update public.hotel_purchase_order_items set quantity_received=quantity_received+v_qty where id=v_item.id;
  v_total:=v_total+(v_qty*v_cost);
 end loop;
 select case when bool_and(quantity_received=quantity_ordered) then 'received' else 'part_received' end into v_po.status from public.hotel_purchase_order_items where purchase_order_id=p_purchase_order_id;
 update public.hotel_purchase_orders set status=v_po.status,updated_at=now() where id=p_purchase_order_id;
 return jsonb_build_object('receipt_id',v_receipt,'receipt_number',p_receipt_number,'value',round(v_total,2),'status',v_po.status);
end $$;
revoke all on function public.hotel_receive_purchase_order(uuid,uuid,text,text,jsonb) from public,anon;
grant execute on function public.hotel_receive_purchase_order(uuid,uuid,text,text,jsonb) to authenticated;
