-- End-of-day cash declarations used by CashDeclarationPanel.
-- Keep this separate from per-POS-shift declarations: this table supports hotel-wide daily/shift reconciliation.
create table if not exists public.hotel_cash_declarations (
 id uuid primary key default gen_random_uuid(),
 hotel_id uuid not null references public.hotels(id) on delete cascade,
 business_date date not null,
 shift text not null default 'Full Day' check (shift in ('Full Day','Morning','Afternoon','Night')),
 prepared_by uuid not null references auth.users(id) on delete restrict,
 designation text not null default 'Manager',
 opening_cash numeric(14,2) not null default 0 check (opening_cash >= 0),
 cash_sales numeric(14,2) not null default 0,
 card_sales numeric(14,2) not null default 0,
 mobile_sales numeric(14,2) not null default 0,
 cash_expenses numeric(14,2) not null default 0,
 cash_paid_out numeric(14,2) not null default 0 check (cash_paid_out >= 0),
 denominations jsonb not null default '{}'::jsonb,
 actual_cash numeric(14,2) not null default 0 check (actual_cash >= 0),
 expected_cash numeric(14,2) not null default 0,
 variance numeric(14,2) not null default 0,
 notes text,
 status text not null default 'draft' check (status in ('draft','submitted','approved','closed')),
 submitted_by uuid references auth.users(id) on delete set null,
 submitted_at timestamptz,
 approved_by uuid references auth.users(id) on delete set null,
 approved_at timestamptz,
 closed_by uuid references auth.users(id) on delete set null,
 closed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(hotel_id,business_date,shift)
);
create index if not exists hotel_cash_declarations_hotel_date_idx
 on public.hotel_cash_declarations(hotel_id,business_date desc);
alter table public.hotel_cash_declarations enable row level security;
drop policy if exists hotel_cash_declarations_read on public.hotel_cash_declarations;
create policy hotel_cash_declarations_read on public.hotel_cash_declarations
 for select to authenticated using (
  exists(select 1 from public.hotels h where h.id=hotel_cash_declarations.hotel_id and h.owner_user_id=auth.uid())
  or exists(select 1 from public.hotel_memberships m where m.hotel_id=hotel_cash_declarations.hotel_id and m.user_id=auth.uid() and m.active)
 );
drop policy if exists hotel_cash_declarations_insert on public.hotel_cash_declarations;
create policy hotel_cash_declarations_insert on public.hotel_cash_declarations
 for insert to authenticated with check (
  prepared_by=auth.uid() and (
   exists(select 1 from public.hotels h where h.id=hotel_cash_declarations.hotel_id and h.owner_user_id=auth.uid())
   or exists(select 1 from public.hotel_memberships m where m.hotel_id=hotel_cash_declarations.hotel_id and m.user_id=auth.uid() and m.active and m.role in ('owner','manager','accountant','pos_cashier','cashier','bar_cashier','restaurant_cashier'))
  )
 );
drop policy if exists hotel_cash_declarations_update on public.hotel_cash_declarations;
create policy hotel_cash_declarations_update on public.hotel_cash_declarations
 for update to authenticated using (
  exists(select 1 from public.hotels h where h.id=hotel_cash_declarations.hotel_id and h.owner_user_id=auth.uid())
  or exists(select 1 from public.hotel_memberships m where m.hotel_id=hotel_cash_declarations.hotel_id and m.user_id=auth.uid() and m.active and m.role in ('owner','manager','accountant'))
  or (prepared_by=auth.uid() and status in ('draft','submitted'))
 ) with check (
  exists(select 1 from public.hotels h where h.id=hotel_cash_declarations.hotel_id and h.owner_user_id=auth.uid())
  or exists(select 1 from public.hotel_memberships m where m.hotel_id=hotel_cash_declarations.hotel_id and m.user_id=auth.uid() and m.active and m.role in ('owner','manager','accountant'))
  or (prepared_by=auth.uid() and status in ('draft','submitted'))
 );
grant select,insert,update on public.hotel_cash_declarations to authenticated;
