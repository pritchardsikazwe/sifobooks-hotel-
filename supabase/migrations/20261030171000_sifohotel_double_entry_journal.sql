-- Hotel double-entry journal, default chart of accounts and report views.
create table if not exists public.hotel_accounts(id uuid primary key default gen_random_uuid(),hotel_id uuid not null references public.hotels(id) on delete cascade,code text not null,name text not null,account_type text not null check(account_type in ('asset','liability','equity','revenue','expense','contra_revenue')),active boolean not null default true,created_at timestamptz not null default now(),unique(hotel_id,code));
create table if not exists public.hotel_journal_entries(id uuid primary key default gen_random_uuid(),hotel_id uuid not null references public.hotels(id) on delete cascade,entry_date date not null default current_date,reference text not null,description text not null,source_type text not null,source_id uuid not null,status text not null default 'posted' check(status in ('posted','reversed')),created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),unique(hotel_id,source_type,source_id));
create table if not exists public.hotel_journal_lines(id uuid primary key default gen_random_uuid(),hotel_id uuid not null references public.hotels(id) on delete cascade,entry_id uuid not null references public.hotel_journal_entries(id) on delete cascade,account_id uuid not null references public.hotel_accounts(id),description text not null,debit numeric(14,2) not null default 0 check(debit>=0),credit numeric(14,2) not null default 0 check(credit>=0),created_at timestamptz not null default now(),check((debit=0 and credit>0) or (credit=0 and debit>0)));
create index if not exists hotel_journal_entries_date_idx on public.hotel_journal_entries(hotel_id,entry_date);
create index if not exists hotel_journal_lines_entry_idx on public.hotel_journal_lines(entry_id);
alter table public.hotel_accounts enable row level security; alter table public.hotel_journal_entries enable row level security; alter table public.hotel_journal_lines enable row level security;
drop policy if exists hotel_accounts_member_read on public.hotel_accounts;
create policy hotel_accounts_member_read on public.hotel_accounts for select to authenticated using(exists(select 1 from public.hotels h where h.id=hotel_accounts.hotel_id and h.owner_user_id=auth.uid()) or exists(select 1 from public.hotel_memberships m where m.hotel_id=hotel_accounts.hotel_id and m.user_id=auth.uid() and m.active and m.role in ('owner','manager','accountant','viewer')));
drop policy if exists hotel_journal_entries_member_read on public.hotel_journal_entries;
create policy hotel_journal_entries_member_read on public.hotel_journal_entries for select to authenticated using(exists(select 1 from public.hotels h where h.id=hotel_journal_entries.hotel_id and h.owner_user_id=auth.uid()) or exists(select 1 from public.hotel_memberships m where m.hotel_id=hotel_journal_entries.hotel_id and m.user_id=auth.uid() and m.active and m.role in ('owner','manager','accountant','viewer')));
drop policy if exists hotel_journal_lines_member_read on public.hotel_journal_lines;
create policy hotel_journal_lines_member_read on public.hotel_journal_lines for select to authenticated using(exists(select 1 from public.hotels h where h.id=hotel_journal_lines.hotel_id and h.owner_user_id=auth.uid()) or exists(select 1 from public.hotel_memberships m where m.hotel_id=hotel_journal_lines.hotel_id and m.user_id=auth.uid() and m.active and m.role in ('owner','manager','accountant','viewer')));
create or replace function public.hotel_ensure_default_accounts(p_hotel_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.hotel_accounts(hotel_id,code,name,account_type) values
 (p_hotel_id,'1000','Cash on hand','asset'),(p_hotel_id,'1010','Bank and mobile money clearing','asset'),(p_hotel_id,'1100','Guest receivables','asset'),(p_hotel_id,'2000','VAT payable - configure before use','liability'),(p_hotel_id,'3000','Opening balance / equity','equity'),(p_hotel_id,'4000','Room revenue','revenue'),(p_hotel_id,'4010','Restaurant and bar revenue','revenue'),(p_hotel_id,'4020','Other hotel revenue','revenue'),(p_hotel_id,'4090','Discounts allowed','contra_revenue'),(p_hotel_id,'5000','Cost of goods sold - not yet calculated','expense'),(p_hotel_id,'6000','Operating expenses','expense') on conflict(hotel_id,code) do nothing;
end $$;
create or replace function public.hotel_post_journal(p_hotel_id uuid,p_reference text,p_description text,p_source_type text,p_source_id uuid,p_debit_code text,p_credit_code text,p_amount numeric,p_entry_date date default current_date) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_entry uuid; v_debit uuid; v_credit uuid;
begin
 if p_amount is null or p_amount<=0 then return null; end if; perform public.hotel_ensure_default_accounts(p_hotel_id);
 select id into v_debit from public.hotel_accounts where hotel_id=p_hotel_id and code=p_debit_code and active;
 select id into v_credit from public.hotel_accounts where hotel_id=p_hotel_id and code=p_credit_code and active;
 if v_debit is null or v_credit is null then raise exception 'Default ledger account missing.'; end if;
 insert into public.hotel_journal_entries(hotel_id,entry_date,reference,description,source_type,source_id,created_by) values(p_hotel_id,coalesce(p_entry_date,current_date),p_reference,p_description,p_source_type,p_source_id,auth.uid()) on conflict(hotel_id,source_type,source_id) do nothing returning id into v_entry;
 if v_entry is null then select id into v_entry from public.hotel_journal_entries where hotel_id=p_hotel_id and source_type=p_source_type and source_id=p_source_id; return v_entry; end if;
 insert into public.hotel_journal_lines(hotel_id,entry_id,account_id,description,debit,credit) values(p_hotel_id,v_entry,v_debit,p_description,p_amount,0),(p_hotel_id,v_entry,v_credit,p_description,0,p_amount);
 return v_entry;
end $$;
create or replace function public.hotel_post_folio_item_journal() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_code text;
begin
 if new.item_type='discount' then perform public.hotel_post_journal(new.hotel_id,coalesce(new.reference,'FOLIO-'||new.id::text),'Discount: '||new.description,'folio_item',new.id,'4090','1100',abs(new.amount),new.service_date);
 else v_code:=case when new.item_type='room_charge' then '4000' when new.item_type='food_beverage' then '4010' else '4020' end; perform public.hotel_post_journal(new.hotel_id,coalesce(new.reference,'FOLIO-'||new.id::text),new.description,'folio_item',new.id,'1100',v_code,abs(new.amount),new.service_date); end if;
 return new;
end $$;
drop trigger if exists hotel_folio_item_journal_after_insert on public.folio_items;
create trigger hotel_folio_item_journal_after_insert after insert on public.folio_items for each row execute function public.hotel_post_folio_item_journal();
create or replace function public.hotel_post_payment_journal() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_debit text; v_amount numeric(14,2);
begin if new.status<>'posted' then return new; end if; v_debit:=case when new.method='cash' then '1000' else '1010' end; v_amount:=abs(new.amount);
 if new.payment_type='refund' then perform public.hotel_post_journal(new.hotel_id,coalesce(new.reference,new.payment_number),'Guest refund '||new.payment_number,'payment',new.id,'1100',v_debit,v_amount,(new.received_at at time zone 'Africa/Lusaka')::date);
 else perform public.hotel_post_journal(new.hotel_id,coalesce(new.reference,new.payment_number),'Guest receipt '||new.payment_number,'payment',new.id,v_debit,'1100',v_amount,(new.received_at at time zone 'Africa/Lusaka')::date); end if; return new; end $$;
drop trigger if exists hotel_payment_journal_after_insert on public.payments;
create trigger hotel_payment_journal_after_insert after insert on public.payments for each row execute function public.hotel_post_payment_journal();
create or replace function public.hotel_post_pos_sale_journal() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_debit text; v_credit text;
begin if new.status<>'posted' then return new; end if; v_debit:=case when new.payment_method='cash' then '1000' else '1010' end; v_credit:=case when new.sale_type in ('bar','restaurant') then '4010' else '4020' end;
 perform public.hotel_post_journal(new.hotel_id,new.receipt_number,'POS sale '||new.sale_type,'pos_sale',new.id,v_debit,v_credit,new.total,(new.created_at at time zone 'Africa/Lusaka')::date); return new; end $$;
drop trigger if exists hotel_pos_sale_journal_after_insert on public.hotel_pos_sales;
create trigger hotel_pos_sale_journal_after_insert after insert on public.hotel_pos_sales for each row execute function public.hotel_post_pos_sale_journal();
create or replace view public.hotel_trial_balance with (security_invoker=true) as select a.hotel_id,a.code,a.name,a.account_type,coalesce(sum(l.debit),0)::numeric(14,2) total_debit,coalesce(sum(l.credit),0)::numeric(14,2) total_credit,(coalesce(sum(l.debit),0)-coalesce(sum(l.credit),0))::numeric(14,2) net_balance from public.hotel_accounts a left join public.hotel_journal_lines l on l.account_id=a.id and l.hotel_id=a.hotel_id left join public.hotel_journal_entries e on e.id=l.entry_id and e.hotel_id=a.hotel_id and e.status='posted' where a.active group by a.hotel_id,a.code,a.name,a.account_type;
create or replace view public.hotel_profit_loss with (security_invoker=true) as select hotel_id,coalesce(sum(case when account_type='revenue' then total_credit-total_debit when account_type='contra_revenue' then -(total_debit-total_credit) else 0 end),0)::numeric(14,2) net_revenue,coalesce(sum(case when account_type='expense' then total_debit-total_credit else 0 end),0)::numeric(14,2) expenses,(coalesce(sum(case when account_type='revenue' then total_credit-total_debit when account_type='contra_revenue' then -(total_debit-total_credit) else 0 end),0)-coalesce(sum(case when account_type='expense' then total_debit-total_credit else 0 end),0))::numeric(14,2) net_profit from public.hotel_trial_balance group by hotel_id;
revoke all on function public.hotel_ensure_default_accounts(uuid) from public,anon,authenticated;
revoke all on function public.hotel_post_journal(uuid,text,text,text,uuid,text,text,numeric,date) from public,anon,authenticated;
grant select on public.hotel_trial_balance,public.hotel_profit_loss to authenticated;
select public.hotel_ensure_default_accounts('ef9388e3-b7e0-4108-9cb4-d6914aad4ba3'::uuid);
