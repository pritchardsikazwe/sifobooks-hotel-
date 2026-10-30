-- Hotel Smart Invoice foundation.
-- Uses the hotel's own taxpayer/device registration; never copy SifoBooks tenant secrets.
-- Credentials and VSDC traffic must remain server-side / on the customer-controlled connector.
create table if not exists public.hotel_zra_settings (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null unique references public.hotels(id) on delete cascade,
  enabled boolean not null default false,
  environment text not null default 'test' check (environment in ('test','production')),
  tpin text,
  branch_id text,
  device_serial text,
  connector_id text,
  connector_status text not null default 'not_configured'
    check (connector_status in ('not_configured','offline','online','error')),
  last_heartbeat_at timestamptz,
  last_error_code text,
  last_error_message text,
  configuration jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hotel_zra_submissions (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  source_type text not null check (source_type in ('folio_invoice','pos_sale','credit_note','debit_note','purchase','stock_movement')),
  source_id uuid not null,
  idempotency_key text not null,
  environment text not null check (environment in ('test','production')),
  status text not null default 'queued'
    check (status in ('queued','sending','accepted','rejected','retry_wait','cancelled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz,
  request_reference text,
  zra_reference text,
  fiscal_signature text,
  receipt_qr_url text,
  response_code text,
  response_message text,
  request_summary jsonb not null default '{}'::jsonb,
  response_summary jsonb not null default '{}'::jsonb,
  submitted_at timestamptz,
  accepted_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hotel_id,idempotency_key)
);

create index if not exists hotel_zra_submissions_queue_idx
  on public.hotel_zra_submissions(status,next_attempt_at,created_at);
create index if not exists hotel_zra_submissions_source_idx
  on public.hotel_zra_submissions(hotel_id,source_type,source_id,created_at desc);

create table if not exists public.hotel_zra_events (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  submission_id uuid references public.hotel_zra_submissions(id) on delete set null,
  event_type text not null,
  status text not null,
  message text,
  details jsonb not null default '{}'::jsonb,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists hotel_zra_events_hotel_created_idx
  on public.hotel_zra_events(hotel_id,created_at desc);

alter table public.hotel_zra_settings enable row level security;
alter table public.hotel_zra_submissions enable row level security;
alter table public.hotel_zra_events enable row level security;

-- Authenticated hotel members can read status/history. Mutating fiscal submissions
-- is intentionally server-only until audited posting/submission RPCs are installed.
drop policy if exists hotel_zra_settings_read_member on public.hotel_zra_settings;
create policy hotel_zra_settings_read_member on public.hotel_zra_settings
  for select to authenticated using (
    exists (select 1 from public.hotel_memberships m
      where m.hotel_id = hotel_zra_settings.hotel_id
        and m.user_id = auth.uid() and m.active = true)
  );

drop policy if exists hotel_zra_submissions_read_member on public.hotel_zra_submissions;
create policy hotel_zra_submissions_read_member on public.hotel_zra_submissions
  for select to authenticated using (
    exists (select 1 from public.hotel_memberships m
      where m.hotel_id = hotel_zra_submissions.hotel_id
        and m.user_id = auth.uid() and m.active = true)
  );

drop policy if exists hotel_zra_events_read_member on public.hotel_zra_events;
create policy hotel_zra_events_read_member on public.hotel_zra_events
  for select to authenticated using (
    exists (select 1 from public.hotel_memberships m
      where m.hotel_id = hotel_zra_events.hotel_id
        and m.user_id = auth.uid() and m.active = true)
  );

drop trigger if exists hotel_zra_settings_set_updated_at on public.hotel_zra_settings;
create trigger hotel_zra_settings_set_updated_at before update on public.hotel_zra_settings
for each row execute function public.set_updated_at();
