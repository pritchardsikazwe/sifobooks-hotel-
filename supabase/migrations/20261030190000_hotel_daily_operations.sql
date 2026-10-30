-- Daily hotel operations: laundry, expenses, opening and closing shift records.
create table if not exists public.hotel_laundry_tasks (
 id uuid primary key default gen_random_uuid(), hotel_id uuid not null references public.hotels(id) on delete cascade,
 room_id uuid, guest_name text, item_description text not null, quantity integer not null default 1 check(quantity>0),
 status text not null default 'received' check(status in ('received','washing','drying','ready','delivered','cancelled')),
 received_at timestamptz not null default now(), due_date date, notes text,
 created_by uuid references auth.users(id), completed_at timestamptz, created_at timestamptz not null default now(),
 foreign key(hotel_id,room_id) references public.rooms(hotel_id,id) on delete set null
);
create table if not exists public.hotel_daily_expenses (
 id uuid primary key default gen_random_uuid(), hotel_id uuid not null references public.hotels(id) on delete cascade,
 expense_date date not null default current_date, category text not null, description text not null,
 amount numeric(14,2) not null check(amount>0), payment_method text not null default 'cash',
 receipt_reference text, status text not null default 'recorded' check(status in ('recorded','approved','rejected')),
 recorded_by uuid references auth.users(id), approved_by uuid references auth.users(id), created_at timestamptz not null default now()
);
create table if not exists public.hotel_business_days (
 id uuid primary key default gen_random_uuid(), hotel_id uuid not null references public.hotels(id) on delete cascade,
 business_date date not null, opening_cash numeric(14,2) not null default 0 check(opening_cash>=0),
 opening_notes text, opened_by uuid references auth.users(id), opened_at timestamptz,
 closing_cash numeric(14,2) check(closing_cash>=0), closing_notes text, closed_by uuid references auth.users(id), closed_at timestamptz,
 status text not null default 'not_open' check(status in ('not_open','open','closed')),
 unique(hotel_id,business_date)
);
alter table public.hotel_laundry_tasks enable row level security;
alter table public.hotel_daily_expenses enable row level security;
alter table public.hotel_business_days enable row level security;
do $$ declare t text; begin
 foreach t in array array['hotel_laundry_tasks','hotel_daily_expenses','hotel_business_days'] loop
  execute format('drop policy if exists %I on public.%I',t||'_members_all',t);
  execute format('create policy %I on public.%I for all to authenticated using (exists(select 1 from public.hotel_memberships hm where hm.hotel_id = %I.hotel_id and hm.user_id = (select auth.uid()) and hm.active)) with check (exists(select 1 from public.hotel_memberships hm where hm.hotel_id = %I.hotel_id and hm.user_id = (select auth.uid()) and hm.active))',t||'_members_all',t,t,t);
 end loop;
end $$;
grant select,insert,update,delete on public.hotel_laundry_tasks,public.hotel_daily_expenses,public.hotel_business_days to authenticated;
