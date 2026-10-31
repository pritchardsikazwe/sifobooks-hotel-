-- Payroll accounting posting and validation reports.
-- Apply only to the dedicated development Supabase project after reviewing the HR schema.
-- All posting is atomic; no live project is changed by committing this file.
create or replace function public.hotel_payroll_authorized(p_hotel_id uuid, p_roles text[])
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.hotels h where h.id=p_hotel_id and h.owner_user_id=auth.uid())
  or exists(select 1 from public.hotel_memberships m where m.hotel_id=p_hotel_id and m.user_id=auth.uid() and m.active and m.role=any(p_roles));
$$;

-- Audit trail is append-only. Draft items may be replaced only while their run is still a draft.
drop policy if exists hotel_payroll_audit_hr_finance_update on public.hotel_payroll_audit;
drop policy if exists hotel_payroll_audit_hr_finance_insert on public.hotel_payroll_audit;
create policy hotel_payroll_audit_hr_finance_insert on public.hotel_payroll_audit for insert to authenticated
with check (public.hotel_payroll_authorized(hotel_id,array['owner','manager','accountant']));
drop policy if exists hotel_payroll_items_hr_finance_delete_draft on public.hotel_payroll_items;
create policy hotel_payroll_items_hr_finance_delete_draft on public.hotel_payroll_items for delete to authenticated
using (public.hotel_payroll_authorized(hotel_id,array['owner','manager','accountant']) and exists(select 1 from public.hotel_payroll_runs r where r.id=payroll_run_id and r.hotel_id=hotel_id and r.status='draft'));
drop trigger if exists hotel_payroll_runs_updated_at on public.hotel_payroll_runs;
create trigger hotel_payroll_runs_updated_at before update on public.hotel_payroll_runs for each row execute function public.set_updated_at();

-- Employer contribution amounts are separated so reports and liabilities remain traceable.
alter table public.hotel_payroll_items add column if not exists napsa_employer numeric(14,2) not null default 0 check(napsa_employer>=0);
alter table public.hotel_payroll_items add column if not exists nhima_employer numeric(14,2) not null default 0 check(nhima_employer>=0);
alter table public.hotel_payroll_items add column if not exists skills_development_levy numeric(14,2) not null default 0 check(skills_development_levy>=0);

create or replace function public.hotel_approve_payroll(p_hotel_id uuid,p_run_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.hotel_payroll_runs%rowtype; v_actor uuid:=auth.uid();
begin
 if v_actor is null or not public.hotel_payroll_authorized(p_hotel_id,array['owner','manager','accountant']) then raise exception 'Not authorised to approve payroll for this hotel'; end if;
 select * into r from public.hotel_payroll_runs where id=p_run_id and hotel_id=p_hotel_id for update;
 if not found then raise exception 'Payroll run not found'; end if;
 if r.status<>'draft' and r.status<>'reviewed' then raise exception 'Only draft or reviewed payroll can be approved'; end if;
 if r.prepared_by=v_actor then raise exception 'The preparer cannot approve their own payroll'; end if;
 if not exists(select 1 from public.hotel_payroll_items i where i.hotel_id=p_hotel_id and i.payroll_run_id=p_run_id) then raise exception 'Payroll has no employee lines'; end if;
 if abs(coalesce((select sum(gross_pay-net_pay-paye-napsa_employee-nhima_employee-other_deductions) from public.hotel_payroll_items where hotel_id=p_hotel_id and payroll_run_id=p_run_id),0))>0.01 then raise exception 'Payroll line arithmetic failed validation'; end if;
 update public.hotel_payroll_runs set status='approved',approved_by=v_actor,approved_at=now() where id=p_run_id;
 insert into public.hotel_payroll_audit(hotel_id,payroll_run_id,actor_user_id,action,details) values(p_hotel_id,p_run_id,v_actor,'approved',jsonb_build_object('gross_total',r.gross_total,'net_total',r.net_total));
 return jsonb_build_object('ok',true,'run_id',p_run_id,'status','approved');
end $$;

create or replace function public.hotel_post_payroll(p_hotel_id uuid,p_run_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.hotel_payroll_runs%rowtype; v_actor uuid:=auth.uid(); v_entry uuid; v_account uuid; v_line record; v_gross numeric(14,2); v_net numeric(14,2); v_paye numeric(14,2); v_napsa numeric(14,2); v_nhima numeric(14,2); v_other numeric(14,2); v_emp_napsa numeric(14,2); v_emp_nhima numeric(14,2); v_sdl numeric(14,2); v_total_debit numeric(14,2);
begin
 if v_actor is null or not public.hotel_payroll_authorized(p_hotel_id,array['owner','accountant']) then raise exception 'Only an authorised owner or accountant can post payroll'; end if;
 select * into r from public.hotel_payroll_runs where id=p_run_id and hotel_id=p_hotel_id for update;
 if not found then raise exception 'Payroll run not found'; end if;
 if r.status='posted' then raise exception 'Payroll already posted'; end if;
 if r.status<>'approved' then raise exception 'Payroll must be approved before posting'; end if;
 if r.approved_by=v_actor then raise exception 'The approver cannot post their own payroll'; end if;
 if exists(select 1 from public.hotel_journal_entries where hotel_id=p_hotel_id and source_type='payroll_run' and source_id=p_run_id) then raise exception 'Journal entry already exists for this payroll run'; end if;
 select coalesce(sum(gross_pay),0),coalesce(sum(net_pay),0),coalesce(sum(paye),0),coalesce(sum(napsa_employee),0),coalesce(sum(nhima_employee),0),coalesce(sum(other_deductions),0),coalesce(sum(napsa_employer),0),coalesce(sum(nhima_employer),0),coalesce(sum(skills_development_levy),0)
 into v_gross,v_net,v_paye,v_napsa,v_nhima,v_other,v_emp_napsa,v_emp_nhima,v_sdl
 from public.hotel_payroll_items where hotel_id=p_hotel_id and payroll_run_id=p_run_id;
 if not exists(select 1 from public.hotel_payroll_items where hotel_id=p_hotel_id and payroll_run_id=p_run_id) then raise exception 'Payroll has no lines'; end if;
 if abs(v_gross-v_net-v_paye-v_napsa-v_nhima-v_other)>0.01 then raise exception 'Payroll totals do not balance'; end if;
 perform public.hotel_ensure_default_accounts(p_hotel_id);
 insert into public.hotel_accounts(hotel_id,code,name,account_type) values
 (p_hotel_id,'6100','Salaries and wages expense','expense'),
 (p_hotel_id,'6110','Employer NAPSA expense','expense'),
 (p_hotel_id,'6120','Employer NHIMA expense','expense'),
 (p_hotel_id,'6130','Skills Development Levy expense','expense'),
 (p_hotel_id,'2100','Net salaries payable','liability'),
 (p_hotel_id,'2110','PAYE payable','liability'),
 (p_hotel_id,'2120','NAPSA payable','liability'),
 (p_hotel_id,'2130','NHIMA payable','liability'),
 (p_hotel_id,'2140','Skills Development Levy payable','liability')
 on conflict(hotel_id,code) do nothing;
 insert into public.hotel_journal_entries(hotel_id,entry_date,reference,description,source_type,source_id,status,created_by)
 values(p_hotel_id,r.payroll_month,'PAYROLL-'||r.run_number,'Monthly payroll '||to_char(r.payroll_month,'YYYY-MM'),'payroll_run',p_run_id,'posted',v_actor) returning id into v_entry;
 for v_line in select code,amount from (values
 ('6100',v_gross),('6110',v_emp_napsa),('6120',v_emp_nhima),('6130',v_sdl),
 ('2100',-v_net),('2110',-v_paye),('2120',-(v_napsa+v_emp_napsa)),('2130',-(v_nhima+v_emp_nhima)),('2140',-v_sdl),('2100',-v_other)
 ) x(code,amount) where amount<>0 loop
   select id into v_account from public.hotel_accounts where hotel_id=p_hotel_id and code=v_line.code and active;
   if v_line.amount>0 then insert into public.hotel_journal_lines(hotel_id,entry_id,account_id,description,debit,credit) values(p_hotel_id,v_entry,v_account,'Payroll '||to_char(r.payroll_month,'YYYY-MM'),v_line.amount,0);
   else insert into public.hotel_journal_lines(hotel_id,entry_id,account_id,description,debit,credit) values(p_hotel_id,v_entry,v_account,'Payroll '||to_char(r.payroll_month,'YYYY-MM'),0,abs(v_line.amount)); end if;
 end loop;
 select coalesce(sum(debit),0)-coalesce(sum(credit),0) into v_total_debit from public.hotel_journal_lines where entry_id=v_entry and hotel_id=p_hotel_id;
 if abs(v_total_debit)>0.01 then raise exception 'Generated payroll journal is not balanced (difference %)',v_total_debit; end if;
 update public.hotel_payroll_runs set status='posted',posted_by=v_actor,posted_at=now() where id=p_run_id;
 insert into public.hotel_payroll_audit(hotel_id,payroll_run_id,actor_user_id,action,details) values(p_hotel_id,p_run_id,v_actor,'posted',jsonb_build_object('journal_entry_id',v_entry,'gross',v_gross,'net',v_net,'paye',v_paye,'napsa_employee',v_napsa,'nhima_employee',v_nhima,'employer_napsa',v_emp_napsa,'employer_nhima',v_emp_nhima,'sdl',v_sdl));
 return jsonb_build_object('ok',true,'run_id',p_run_id,'journal_entry_id',v_entry,'status','posted','debits',v_gross+v_emp_napsa+v_emp_nhima+v_sdl,'credits',v_gross+v_emp_napsa+v_emp_nhima+v_sdl);
end $$;

create or replace view public.hotel_payroll_monthly_report with (security_invoker=true) as
select r.hotel_id,r.id payroll_run_id,r.payroll_month,r.run_number,r.status,r.currency_code,
 count(i.id)::integer employee_count,coalesce(sum(i.gross_pay),0)::numeric(14,2) gross_total,
 coalesce(sum(i.paye),0)::numeric(14,2) paye_total,coalesce(sum(i.napsa_employee),0)::numeric(14,2) napsa_employee_total,
 coalesce(sum(i.nhima_employee),0)::numeric(14,2) nhima_employee_total,
 coalesce(sum(i.napsa_employer),0)::numeric(14,2) napsa_employer_total,
 coalesce(sum(i.nhima_employer),0)::numeric(14,2) nhima_employer_total,
 coalesce(sum(i.skills_development_levy),0)::numeric(14,2) sdl_total,
 coalesce(sum(i.other_deductions),0)::numeric(14,2) other_deductions_total,
 coalesce(sum(i.net_pay),0)::numeric(14,2) net_total,r.posted_at,r.approved_at
from public.hotel_payroll_runs r left join public.hotel_payroll_items i on i.hotel_id=r.hotel_id and i.payroll_run_id=r.id
group by r.hotel_id,r.id,r.payroll_month,r.run_number,r.status,r.currency_code,r.posted_at,r.approved_at;

grant select on public.hotel_payroll_monthly_report to authenticated;
revoke all on function public.hotel_payroll_authorized(uuid,text[]) from public,anon;
revoke all on function public.hotel_approve_payroll(uuid,uuid) from public,anon;
revoke all on function public.hotel_post_payroll(uuid,uuid) from public,anon;
grant execute on function public.hotel_approve_payroll(uuid,uuid) to authenticated;
grant execute on function public.hotel_post_payroll(uuid,uuid) to authenticated;
