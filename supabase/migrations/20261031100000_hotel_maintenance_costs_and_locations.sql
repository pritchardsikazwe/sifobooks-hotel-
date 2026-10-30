-- Hotel maintenance work history, costs and multi-town property locations.
create table if not exists public.hotel_maintenance_work_logs (
 id uuid primary key default gen_random_uuid(),
 hotel_id uuid not null references public.hotels(id) on delete cascade,
 maintenance_request_id uuid references public.maintenance_requests(id) on delete set null,
 room_id uuid references public.rooms(id) on delete set null,
 work_title text not null,
 work_description text,
 performed_by text,
 vendor_name text,
 work_date date not null default current_date,
 status text not null default 'completed' check (status in ('planned','in_progress','completed','cancelled')),
 labour_cost numeric(12,2) not null default 0 check (labour_cost >= 0),
 parts_cost numeric(12,2) not null default 0 check (parts_cost >= 0),
 other_cost numeric(12,2) not null default 0 check (other_cost >= 0),
 total_cost numeric(12,2) generated always as (labour_cost + parts_cost + other_cost) stored,
 invoice_reference text,
 notes text,
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now()
);
create table if not exists public.hotel_locations (
 id uuid primary key default gen_random_uuid(),
 hotel_id uuid not null references public.hotels(id) on delete cascade,
 location_name text not null,
 town text not null,
 address text,
 phone text,
 email text,
 manager_name text,
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(hotel_id, location_name, town)
);
create index if not exists hotel_maintenance_work_logs_hotel_date_idx on public.hotel_maintenance_work_logs(hotel_id, work_date desc);
create index if not exists hotel_locations_hotel_town_idx on public.hotel_locations(hotel_id, town);
alter table public.hotel_maintenance_work_logs enable row level security;
alter table public.hotel_locations enable row level security;
drop policy if exists hotel_maintenance_work_logs_read on public.hotel_maintenance_work_logs;
create policy hotel_maintenance_work_logs_read on public.hotel_maintenance_work_logs for select to authenticated using (
 exists(select 1 from public.hotels h where h.id=hotel_id and h.owner_user_id=auth.uid())
 or exists(select 1 from public.hotel_memberships m where m.hotel_id=hotel_id and m.user_id=auth.uid() and m.active=true and m.role in ('owner','manager','maintenance','accountant','viewer'))
);
drop policy if exists hotel_maintenance_work_logs_write on public.hotel_maintenance_work_logs;
create policy hotel_maintenance_work_logs_write on public.hotel_maintenance_work_logs for all to authenticated using (
 exists(select 1 from public.hotels h where h.id=hotel_id and h.owner_user_id=auth.uid())
 or exists(select 1 from public.hotel_memberships m where m.hotel_id=hotel_id and m.user_id=auth.uid() and m.active=true and m.role in ('owner','manager','maintenance','accountant'))
) with check (
 exists(select 1 from public.hotels h where h.id=hotel_id and h.owner_user_id=auth.uid())
 or exists(select 1 from public.hotel_memberships m where m.hotel_id=hotel_id and m.user_id=auth.uid() and m.active=true and m.role in ('owner','manager','maintenance','accountant'))
);
drop policy if exists hotel_locations_read on public.hotel_locations;
create policy hotel_locations_read on public.hotel_locations for select to authenticated using (
 exists(select 1 from public.hotels h where h.id=hotel_id and h.owner_user_id=auth.uid())
 or exists(select 1 from public.hotel_memberships m where m.hotel_id=hotel_id and m.user_id=auth.uid() and m.active=true)
);
drop policy if exists hotel_locations_write on public.hotel_locations;
create policy hotel_locations_write on public.hotel_locations for all to authenticated using (
 exists(select 1 from public.hotels h where h.id=hotel_id and h.owner_user_id=auth.uid())
 or exists(select 1 from public.hotel_memberships m where m.hotel_id=hotel_id and m.user_id=auth.uid() and m.active=true and m.role in ('owner','manager'))
) with check (
 exists(select 1 from public.hotels h where h.id=hotel_id and h.owner_user_id=auth.uid())
 or exists(select 1 from public.hotel_memberships m where m.hotel_id=hotel_id and m.user_id=auth.uid() and m.active=true and m.role in ('owner','manager'))
);
