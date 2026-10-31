-- HR and monthly payroll schema for SifoBooks Hotel.
-- Version-controlled only: this migration is NOT automatically applied to any Supabase project.
create table if not exists public.hotel_employees (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  employee_number text not null,
  first_name text not null,
  last_name text not null,
  email text,
  phone text,
  department text not null,
  job_title text not null,
  employment_type text not null default 'permanent' check (employment_type in ('permanent','fixed_term','casual','part_time','intern')),
  employment_status text not null default 'active' check (employment_status in ('active','on_leave','suspended','terminated')),
  start_date date not null,
  contract_end_date date,
  basic_monthly_salary numeric(14,2) not null default 0 check (basic_monthly_salary >= 0),
  bank_name text,
  bank_account_name text,
  bank_account_number text,
  napsa_number text,
  nhima_number text,
  tax_identifier text,
  emergency_contact_name text,
  emergency_contact_phone text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(hotel_id, employee_number),
  unique(hotel_id, id),
  check (contract_end_date is null or contract_end_date >= start_date)
);
create index if not exists hotel_employees_hotel_status_idx on public.hotel_employees(hotel_id,employment_status);
drop trigger if exists hotel_employees_updated_at on public.hotel_employees;
create trigger hotel_employees_updated_at before update on public.hotel_employees
for each row execute function public.set_updated_at();

create table if not exists public.hotel_employee_contracts (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  employee_id uuid not null,
  contract_type text not null check (contract_type in ('permanent','fixed_term','casual','part_time','intern')),
  start_date date not null,
  end_date date,
  probation_end_date date,
  signed_on date,
  document_path text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key(hotel_id,employee_id) references public.hotel_employees(hotel_id,id) on delete cascade,
  unique(hotel_id,id),
  check(end_date is null or end_date >= start_date)
);
create table if not exists public.hotel_leave_requests (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  employee_id uuid not null,
  leave_type text not null check (leave_type in ('annual','sick','maternity','paternity','family_responsibility','compassionate','unpaid','other')),
  start_date date not null,
  end_date date not null,
  days_requested numeric(6,2) not null check(days_requested > 0),
  reason text,
  status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key(hotel_id,employee_id) references public.hotel_employees(hotel_id,id) on delete cascade,
  check(end_date >= start_date)
);
create table if not exists public.hotel_payroll_runs (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  payroll_month date not null,
  run_number text not null,
  status text not null default 'draft' check(status in ('draft','reviewed','approved','posted','reversed')),
  currency_code char(3) not null default 'ZMW',
  employee_count integer not null default 0 check(employee_count >= 0),
  gross_total numeric(14,2) not null default 0 check(gross_total >= 0),
  deductions_total numeric(14,2) not null default 0 check(deductions_total >= 0),
  net_total numeric(14,2) not null default 0 check(net_total >= 0),
  prepared_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  posted_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  approved_at timestamptz,
  posted_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(hotel_id,run_number),
  unique(hotel_id,payroll_month),
  unique(hotel_id,id)
);
create trigger hotel_payroll_runs_updated_at before update on public.hotel_payroll_runs
for each row execute function public.set_updated_at();

create table if not exists public.hotel_payroll_items (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  payroll_run_id uuid not null,
  employee_id uuid not null,
  basic_pay numeric(14,2) not null default 0 check(basic_pay >= 0),
  allowances numeric(14,2) not null default 0 check(allowances >= 0),
  overtime_pay numeric(14,2) not null default 0 check(overtime_pay >= 0),
  bonus_pay numeric(14,2) not null default 0 check(bonus_pay >= 0),
  gross_pay numeric(14,2) not null default 0 check(gross_pay >= 0),
  paye numeric(14,2) not null default 0 check(paye >= 0),
  napsa_employee numeric(14,2) not null default 0 check(napsa_employee >= 0),
  nhima_employee numeric(14,2) not null default 0 check(nhima_employee >= 0),
  other_deductions numeric(14,2) not null default 0 check(other_deductions >= 0),
  net_pay numeric(14,2) not null default 0 check(net_pay >= 0),
  employer_contributions numeric(14,2) not null default 0 check(employer_contributions >= 0),
  calculation_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key(hotel_id,payroll_run_id) references public.hotel_payroll_runs(hotel_id,id) on delete cascade,
  foreign key(hotel_id,employee_id) references public.hotel_employees(hotel_id,id) on delete restrict,
  unique(payroll_run_id,employee_id)
);
create table if not exists public.hotel_payroll_components (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  employee_id uuid,
  component_name text not null,
  component_type text not null check(component_type in ('earning','deduction','employer_contribution')),
  amount numeric(14,2) not null check(amount >= 0),
  recurring boolean not null default false,
  effective_from date not null default current_date,
  effective_to date,
  authorised boolean not null default false,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key(hotel_id,employee_id) references public.hotel_employees(hotel_id,id) on delete cascade,
  check(effective_to is null or effective_to >= effective_from)
);
create table if not exists public.hotel_payroll_audit (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete cascade,
  payroll_run_id uuid,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key(hotel_id,payroll_run_id) references public.hotel_payroll_runs(hotel_id,id) on delete restrict
);

-- Employee pay data and payroll records are confidential. Only active tenant members
-- with HR/Finance/management roles can access them. Employees self-service access is
-- deliberately not enabled until a secure employee-to-auth-user mapping is implemented.
alter table public.hotel_employees enable row level security;
alter table public.hotel_employee_contracts enable row level security;
alter table public.hotel_leave_requests enable row level security;
alter table public.hotel_payroll_runs enable row level security;
alter table public.hotel_payroll_items enable row level security;
alter table public.hotel_payroll_components enable row level security;
alter table public.hotel_payroll_audit enable row level security;

do $$
declare t text;
begin
 foreach t in array array['hotel_employees','hotel_employee_contracts','hotel_leave_requests','hotel_payroll_runs','hotel_payroll_items','hotel_payroll_components','hotel_payroll_audit'] loop
  execute format('drop policy if exists %I on public.%I',t||'_hr_finance_read',t);
  execute format('create policy %I on public.%I for select to authenticated using (exists (select 1 from public.hotel_memberships hm where hm.hotel_id = %I.hotel_id and hm.user_id = (select auth.uid()) and hm.active and hm.role in (''owner'',''manager'',''accountant'')))',t||'_hr_finance_read',t,t);
  execute format('drop policy if exists %I on public.%I',t||'_hr_finance_insert',t);
  execute format('create policy %I on public.%I for insert to authenticated with check (exists (select 1 from public.hotel_memberships hm where hm.hotel_id = %I.hotel_id and hm.user_id = (select auth.uid()) and hm.active and hm.role in (''owner'',''manager'',''accountant'')))',t||'_hr_finance_insert',t,t);
  execute format('drop policy if exists %I on public.%I',t||'_hr_finance_update',t);
  execute format('create policy %I on public.%I for update to authenticated using (exists (select 1 from public.hotel_memberships hm where hm.hotel_id = %I.hotel_id and hm.user_id = (select auth.uid()) and hm.active and hm.role in (''owner'',''manager'',''accountant''))) with check (exists (select 1 from public.hotel_memberships hm where hm.hotel_id = %I.hotel_id and hm.user_id = (select auth.uid()) and hm.active and hm.role in (''owner'',''manager'',''accountant'')))',t||'_hr_finance_update',t,t,t);
 end loop;
end $$;
grant select,insert,update on public.hotel_employees, public.hotel_employee_contracts, public.hotel_leave_requests, public.hotel_payroll_runs, public.hotel_payroll_items, public.hotel_payroll_components, public.hotel_payroll_audit to authenticated;
