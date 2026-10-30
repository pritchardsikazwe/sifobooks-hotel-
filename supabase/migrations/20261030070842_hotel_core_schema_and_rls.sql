-- SifoBooks Hotel core schema. Fresh-project migration.
-- This is the version-controlled schema for the dedicated project. Never put secrets here.
create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public
as $$ begin new.updated_at = now(); return new; end; $$;

create table public.hotels (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  name text not null check (length(trim(name)) between 2 and 160),
  legal_name text, email text, phone text, address text, city text,
  country text not null default 'Zambia',
  currency_code char(3) not null default 'ZMW',
  timezone text not null default 'Africa/Lusaka',
  check_in_time time not null default '14:00',
  check_out_time time not null default '10:00',
  tax_registration_number text,
  vat_enabled boolean not null default false,
  vat_rate numeric(5,2) not null default 0 check (vat_rate between 0 and 100),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.hotel_memberships (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'staff' check (role in ('owner','manager','receptionist','housekeeping','accountant','maintenance','viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (hotel_id,user_id)
);

create table public.room_types (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  name text not null, code text not null, description text,
  max_occupancy integer not null default 2 check (max_occupancy > 0),
  base_rate numeric(14,2) not null default 0 check (base_rate >= 0),
  amenities jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (hotel_id,code), unique (hotel_id,name), unique (hotel_id,id)
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  room_type_id uuid not null,
  room_number text not null, floor_label text,
  status text not null default 'available' check (status in ('available','reserved','occupied','dirty','cleaning','inspected','maintenance','out_of_service')),
  notes text, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (hotel_id,room_number), unique (hotel_id,id),
  foreign key (hotel_id,room_type_id) references public.room_types(hotel_id,id) on delete restrict
);

create table public.guests (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  first_name text not null, last_name text not null, email text, phone text, nationality text,
  id_document_type text, id_document_number text, company_name text, address text, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (hotel_id,id)
);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  reservation_number text not null, guest_id uuid not null, room_id uuid not null,
  check_in_date date not null, check_out_date date not null,
  adults integer not null default 1 check (adults > 0),
  children integer not null default 0 check (children >= 0),
  nightly_rate numeric(14,2) not null check (nightly_rate >= 0),
  currency_code char(3) not null default 'ZMW',
  status text not null default 'pending' check (status in ('pending','confirmed','checked_in','checked_out','cancelled','no_show')),
  source text not null default 'direct', special_requests text, internal_notes text,
  created_by uuid references auth.users(id) on delete set null,
  checked_in_at timestamptz, checked_out_at timestamptz, cancelled_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (hotel_id,reservation_number), unique (hotel_id,id),
  check (check_out_date > check_in_date),
  foreign key (hotel_id,guest_id) references public.guests(hotel_id,id) on delete restrict,
  foreign key (hotel_id,room_id) references public.rooms(hotel_id,id) on delete restrict
);

create index reservations_room_dates_idx on public.reservations(room_id,check_in_date,check_out_date);
create index reservations_hotel_status_idx on public.reservations(hotel_id,status,check_in_date);
create index reservations_hotel_guest_idx on public.reservations(hotel_id,guest_id);
create index reservations_hotel_room_idx on public.reservations(hotel_id,room_id);
create index guests_hotel_name_idx on public.guests(hotel_id,last_name,first_name);

create or replace function public.prevent_room_double_booking()
returns trigger language plpgsql set search_path = public
as $$
begin
  if new.status in ('pending','confirmed','checked_in') then
    perform pg_advisory_xact_lock(hashtextextended(new.room_id::text,0));
    if exists (
      select 1 from public.reservations r
      where r.room_id = new.room_id
        and r.id <> coalesce(new.id,'00000000-0000-0000-0000-000000000000'::uuid)
        and r.status in ('pending','confirmed','checked_in')
        and daterange(r.check_in_date,r.check_out_date,'[)') &&
            daterange(new.check_in_date,new.check_out_date,'[)')
    ) then
      raise exception 'Room is already reserved for part or all of these dates' using errcode = '23P01';
    end if;
  end if;
  return new;
end; $$;
create trigger reservations_prevent_double_booking
before insert or update of room_id,check_in_date,check_out_date,status on public.reservations
for each row execute function public.prevent_room_double_booking();

create table public.folios (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  reservation_id uuid not null unique, folio_number text not null,
  status text not null default 'open' check (status in ('open','closed','void')),
  opened_at timestamptz not null default now(), closed_at timestamptz, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (hotel_id,folio_number), unique (hotel_id,id),
  foreign key (hotel_id,reservation_id) references public.reservations(hotel_id,id) on delete restrict
);

create table public.folio_items (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  folio_id uuid not null, item_type text not null check (item_type in ('room_charge','food_beverage','service','tax','discount','adjustment','other')),
  description text not null, quantity numeric(12,3) not null default 1 check (quantity > 0),
  unit_price numeric(14,2) not null default 0, amount numeric(14,2) not null,
  service_date date not null default current_date, reference text,
  posted_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(),
  foreign key (hotel_id,folio_id) references public.folios(hotel_id,id) on delete restrict
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  reservation_id uuid, folio_id uuid, payment_number text not null,
  payment_type text not null default 'receipt' check (payment_type in ('deposit','receipt','refund')),
  method text not null check (method in ('cash','card','bank_transfer','mobile_money','voucher','other')),
  amount numeric(14,2) not null check (amount > 0), currency_code char(3) not null default 'ZMW',
  reference text, status text not null default 'posted' check (status in ('pending','posted','voided')),
  received_at timestamptz not null default now(), received_by uuid references auth.users(id) on delete set null,
  notes text, created_at timestamptz not null default now(),
  unique (hotel_id,payment_number), check (reservation_id is not null or folio_id is not null),
  foreign key (hotel_id,reservation_id) references public.reservations(hotel_id,id) on delete restrict,
  foreign key (hotel_id,folio_id) references public.folios(hotel_id,id) on delete restrict
);

create table public.housekeeping_tasks (
  id uuid primary key default gen_random_uuid(), hotel_id uuid not null references public.hotels(id) on delete cascade,
  room_id uuid not null, task_type text not null default 'cleaning' check (task_type in ('cleaning','inspection','linen','turndown','deep_clean','other')),
  status text not null default 'pending' check (status in ('pending','assigned','in_progress','completed','verified','cancelled')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  assigned_to uuid references auth.users(id) on delete set null, due_at timestamptz, started_at timestamptz, completed_at timestamptz,
  verified_by uuid references auth.users(id) on delete set null, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (hotel_id,room_id) references public.rooms(hotel_id,id) on delete restrict
);

create table public.maintenance_requests (
  id uuid primary key default gen_random_uuid(), hotel_id uuid not null references public.hotels(id) on delete cascade,
  room_id uuid, title text not null, description text,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'open' check (status in ('open','assigned','in_progress','on_hold','completed','cancelled')),
  assigned_to uuid references auth.users(id) on delete set null, blocks_room_sale boolean not null default true,
  reported_by uuid references auth.users(id) on delete set null, resolved_at timestamptz, resolution_notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (hotel_id,room_id) references public.rooms(hotel_id,id) on delete restrict
);

create table public.night_audits (
  id uuid primary key default gen_random_uuid(), hotel_id uuid not null references public.hotels(id) on delete cascade,
  business_date date not null, status text not null default 'open' check (status in ('open','review','closed','reopened')),
  room_revenue numeric(14,2) not null default 0, other_revenue numeric(14,2) not null default 0,
  payments_total numeric(14,2) not null default 0, variance numeric(14,2) not null default 0,
  checklist jsonb not null default '{}'::jsonb, notes text,
  opened_by uuid references auth.users(id) on delete set null, closed_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (hotel_id,business_date)
);

create table public.hotel_audit_events (
  id uuid primary key default gen_random_uuid(), hotel_id uuid not null references public.hotels(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null, entity_type text not null, entity_id uuid,
  action text not null, before_data jsonb, after_data jsonb, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index hotel_memberships_user_active_idx on public.hotel_memberships(user_id,active);
create index room_types_hotel_active_idx on public.room_types(hotel_id,active);
create index rooms_hotel_status_idx on public.rooms(hotel_id,status,active);
create index folio_items_folio_idx on public.folio_items(folio_id);
create index folio_items_hotel_idx on public.folio_items(hotel_id);
create index payments_folio_idx on public.payments(folio_id);
create index payments_reservation_idx on public.payments(reservation_id);
create index payments_received_by_idx on public.payments(received_by);
create index hotel_audit_events_hotel_created_idx on public.hotel_audit_events(hotel_id,created_at desc);
create index housekeeping_tasks_hotel_status_idx on public.housekeeping_tasks(hotel_id,status,due_at);
create index maintenance_requests_hotel_status_idx on public.maintenance_requests(hotel_id,status,priority);

do $$
declare t text;
begin
  foreach t in array array['hotels','room_types','rooms','guests','reservations','folios','housekeeping_tasks','maintenance_requests','night_audits'] loop
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()',t,t);
  end loop;
end $$;

alter table public.hotels enable row level security;
alter table public.hotel_memberships enable row level security;
alter table public.room_types enable row level security;
alter table public.rooms enable row level security;
alter table public.guests enable row level security;
alter table public.reservations enable row level security;
alter table public.folios enable row level security;
alter table public.folio_items enable row level security;
alter table public.payments enable row level security;
alter table public.housekeeping_tasks enable row level security;
alter table public.maintenance_requests enable row level security;
alter table public.night_audits enable row level security;
alter table public.hotel_audit_events enable row level security;

create policy "hotel owners and members can read hotels" on public.hotels for select to authenticated
using (owner_user_id = (select auth.uid()) or exists (
  select 1 from public.hotel_memberships hm where hm.hotel_id = hotels.id and hm.user_id = (select auth.uid()) and hm.active
));
create policy "authenticated users can create own hotels" on public.hotels for insert to authenticated
with check (owner_user_id = (select auth.uid()));
create policy "hotel owners can update hotels" on public.hotels for update to authenticated
using (owner_user_id = (select auth.uid())) with check (owner_user_id = (select auth.uid()));

create policy "users can read their own memberships" on public.hotel_memberships for select to authenticated
using (user_id = (select auth.uid()));
create policy "hotel owners can add their own membership" on public.hotel_memberships for insert to authenticated
with check (user_id = (select auth.uid()) and exists (select 1 from public.hotels h where h.id = hotel_id and h.owner_user_id = (select auth.uid())));
create policy "hotel owners can update memberships" on public.hotel_memberships for update to authenticated
using (exists (select 1 from public.hotels h where h.id = hotel_id and h.owner_user_id = (select auth.uid())))
with check (exists (select 1 from public.hotels h where h.id = hotel_id and h.owner_user_id = (select auth.uid())));
create policy "hotel owners can remove memberships" on public.hotel_memberships for delete to authenticated
using (exists (select 1 from public.hotels h where h.id = hotel_id and h.owner_user_id = (select auth.uid())));

do $$
declare t text;
begin
  foreach t in array array['room_types','rooms','guests','reservations','folios','folio_items','payments','housekeeping_tasks','maintenance_requests','night_audits'] loop
    execute format('create policy %I on public.%I for all to authenticated using (exists (select 1 from public.hotel_memberships hm where hm.hotel_id = %I.hotel_id and hm.user_id = (select auth.uid()) and hm.active)) with check (exists (select 1 from public.hotel_memberships hm where hm.hotel_id = %I.hotel_id and hm.user_id = (select auth.uid()) and hm.active))',t||'_members_all',t,t,t);
  end loop;
end $$;

create policy "hotel members can read audit events" on public.hotel_audit_events for select to authenticated
using (exists (select 1 from public.hotel_memberships hm where hm.hotel_id = hotel_audit_events.hotel_id and hm.user_id = (select auth.uid()) and hm.active));
create policy "hotel members can create audit events" on public.hotel_audit_events for insert to authenticated
with check (actor_user_id = (select auth.uid()) and exists (select 1 from public.hotel_memberships hm where hm.hotel_id = hotel_audit_events.hotel_id and hm.user_id = (select auth.uid()) and hm.active));

grant usage on schema public to authenticated;
grant select,insert,update,delete on public.hotels,public.hotel_memberships,public.room_types,public.rooms,public.guests,public.reservations,public.folios,public.folio_items,public.payments,public.housekeeping_tasks,public.maintenance_requests,public.night_audits to authenticated;
grant select,insert on public.hotel_audit_events to authenticated;
