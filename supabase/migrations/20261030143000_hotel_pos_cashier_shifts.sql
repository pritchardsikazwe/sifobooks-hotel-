-- POS, bar and restaurant cashier workspace
create table if not exists public.hotel_pos_inventory (
 id uuid primary key default gen_random_uuid(),
 hotel_id uuid not null references public.hotels(id) on delete cascade,
 name text not null,
 sku text,
 category text not null default 'restaurant',
 unit text not null default 'each',
 sale_price numeric(12,2) not null default 0 check (sale_price >= 0),
 stock_quantity numeric(12,3) not null default 0 check (stock_quantity >= 0),
 active boolean not null default true,
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.hotel_pos_shifts (
 id uuid primary key default gen_random_uuid(),
 hotel_id uuid not null references public.hotels(id) on delete cascade,
 cashier_id uuid not null references auth.users(id) on delete restrict,
 terminal_name text not null default 'Main POS',
 opened_at timestamptz not null default now(),
 opening_cash numeric(12,2) not null default 0 check (opening_cash >= 0),
 closed_at timestamptz,
 closing_cash numeric(12,2),
 expected_cash numeric(12,2) not null default 0,
 cash_variance numeric(12,2),
 status text not null default 'open' check(status in ('open','closed')),
 notes text,
 created_at timestamptz not null default now()
);
create unique index if not exists hotel_pos_one_open_shift_per_cashier on public.hotel_pos_shifts(hotel_id,cashier_id) where status='open';
create table if not exists public.hotel_pos_sales (
 id uuid primary key default gen_random_uuid(),
 hotel_id uuid not null references public.hotels(id) on delete cascade,
 shift_id uuid references public.hotel_pos_shifts(id) on delete set null,
 cashier_id uuid not null references auth.users(id) on delete restrict,
 receipt_number text not null,
 sale_type text not null default 'restaurant' check(sale_type in ('bar','restaurant','cash_sale')),
 payment_method text not null default 'cash' check(payment_method in ('cash','card','mobile_money','bank_transfer')),
 subtotal numeric(12,2) not null default 0,
 total numeric(12,2) not null default 0,
 status text not null default 'posted' check(status in ('posted','voided')),
 notes text,
 created_at timestamptz not null default now(),
 unique(hotel_id,receipt_number)
);
create table if not exists public.hotel_pos_sale_items (
 id uuid primary key default gen_random_uuid(),
 hotel_id uuid not null references public.hotels(id) on delete cascade,
 sale_id uuid not null references public.hotel_pos_sales(id) on delete cascade,
 inventory_item_id uuid references public.hotel_pos_inventory(id) on delete set null,
 item_name text not null,
 quantity numeric(12,3) not null check(quantity > 0),
 unit_price numeric(12,2) not null check(unit_price >= 0),
 line_total numeric(12,2) not null check(line_total >= 0),
 created_at timestamptz not null default now()
);
create table if not exists public.hotel_pos_cash_declarations (
 id uuid primary key default gen_random_uuid(),
 hotel_id uuid not null references public.hotels(id) on delete cascade,
 shift_id uuid not null references public.hotel_pos_shifts(id) on delete cascade,
 cashier_id uuid not null references auth.users(id) on delete restrict,
 declaration_type text not null check(declaration_type in ('cash_in','cash_out','closing_count')),
 amount numeric(12,2) not null check(amount >= 0),
 reason text not null,
 counted_at timestamptz not null default now(),
 created_at timestamptz not null default now()
);
create index if not exists hotel_pos_sales_hotel_created_idx on public.hotel_pos_sales(hotel_id,created_at desc);
create index if not exists hotel_pos_items_hotel_idx on public.hotel_pos_sale_items(hotel_id,sale_id);
alter table public.hotel_pos_inventory enable row level security;
alter table public.hotel_pos_shifts enable row level security;
alter table public.hotel_pos_sales enable row level security;
alter table public.hotel_pos_sale_items enable row level security;
alter table public.hotel_pos_cash_declarations enable row level security;
do $$ declare t text; begin
 foreach t in array array['hotel_pos_inventory','hotel_pos_shifts','hotel_pos_sales','hotel_pos_sale_items','hotel_pos_cash_declarations'] loop
  execute format('drop policy if exists %I on public.%I','hotel_pos_select_members',t);
  execute format('create policy %I on public.%I for select to authenticated using (exists (select 1 from public.hotels h where h.id = hotel_id and h.owner_user_id = auth.uid()) or exists (select 1 from public.hotel_memberships m where m.hotel_id = hotel_id and m.user_id = auth.uid() and m.active = true and m.role in (''owner'',''manager'',''pos_cashier'',''cashier'',''bar_cashier'',''restaurant_cashier'',''accountant'')))', 'hotel_pos_select_members', t);
  execute format('drop policy if exists %I on public.%I','hotel_pos_write_cashier',t);
 end loop;
end $$;
drop policy if exists hotel_pos_inventory_write on public.hotel_pos_inventory;
create policy hotel_pos_inventory_write on public.hotel_pos_inventory for all to authenticated using (
 exists(select 1 from public.hotels h where h.id=hotel_id and h.owner_user_id=auth.uid()) or
 exists(select 1 from public.hotel_memberships m where m.hotel_id=hotel_id and m.user_id=auth.uid() and m.active and m.role in ('owner','manager','accountant'))
) with check (
 exists(select 1 from public.hotels h where h.id=hotel_id and h.owner_user_id=auth.uid()) or
 exists(select 1 from public.hotel_memberships m where m.hotel_id=hotel_id and m.user_id=auth.uid() and m.active and m.role in ('owner','manager','accountant'))
);
create policy hotel_pos_shift_write on public.hotel_pos_shifts for all to authenticated using (
 cashier_id=auth.uid() or exists(select 1 from public.hotels h where h.id=hotel_id and h.owner_user_id=auth.uid()) or
 exists(select 1 from public.hotel_memberships m where m.hotel_id=hotel_id and m.user_id=auth.uid() and m.active and m.role in ('owner','manager'))
) with check (
 cashier_id=auth.uid() or exists(select 1 from public.hotels h where h.id=hotel_id and h.owner_user_id=auth.uid()) or
 exists(select 1 from public.hotel_memberships m where m.hotel_id=hotel_id and m.user_id=auth.uid() and m.active and m.role in ('owner','manager'))
);
create policy hotel_pos_sales_write on public.hotel_pos_sales for all to authenticated using (
 cashier_id=auth.uid() or exists(select 1 from public.hotels h where h.id=hotel_id and h.owner_user_id=auth.uid()) or
 exists(select 1 from public.hotel_memberships m where m.hotel_id=hotel_id and m.user_id=auth.uid() and m.active and m.role in ('owner','manager'))
) with check (
 cashier_id=auth.uid() or exists(select 1 from public.hotels h where h.id=hotel_id and h.owner_user_id=auth.uid()) or
 exists(select 1 from public.hotel_memberships m where m.hotel_id=hotel_id and m.user_id=auth.uid() and m.active and m.role in ('owner','manager'))
);
create policy hotel_pos_sale_items_write on public.hotel_pos_sale_items for all to authenticated using (
 exists(select 1 from public.hotel_pos_sales s where s.id=sale_id and (s.cashier_id=auth.uid() or exists(select 1 from public.hotels h where h.id=s.hotel_id and h.owner_user_id=auth.uid()) or exists(select 1 from public.hotel_memberships m where m.hotel_id=s.hotel_id and m.user_id=auth.uid() and m.active and m.role in ('owner','manager'))))
) with check (
 exists(select 1 from public.hotel_pos_sales s where s.id=sale_id and s.hotel_id=hotel_id and (s.cashier_id=auth.uid() or exists(select 1 from public.hotels h where h.id=s.hotel_id and h.owner_user_id=auth.uid()) or exists(select 1 from public.hotel_memberships m where m.hotel_id=s.hotel_id and m.user_id=auth.uid() and m.active and m.role in ('owner','manager'))))
);
create policy hotel_pos_cash_declarations_write on public.hotel_pos_cash_declarations for all to authenticated using (
 cashier_id=auth.uid() or exists(select 1 from public.hotels h where h.id=hotel_id and h.owner_user_id=auth.uid()) or
 exists(select 1 from public.hotel_memberships m where m.hotel_id=hotel_id and m.user_id=auth.uid() and m.active and m.role in ('owner','manager'))
) with check (
 cashier_id=auth.uid() or exists(select 1 from public.hotels h where h.id=hotel_id and h.owner_user_id=auth.uid()) or
 exists(select 1 from public.hotel_memberships m where m.hotel_id=hotel_id and m.user_id=auth.uid() and m.active and m.role in ('owner','manager'))
);
