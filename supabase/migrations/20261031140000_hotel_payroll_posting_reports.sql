-- Controlled monthly payroll posting and reporting. Development branch only.
create or replace function public.hotel_payroll_authorized(p_hotel_id uuid,p_roles text[])
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.hotels h where h.id=p_hotel_id and h.owner_user_id=auth.uid())
 or exists(select 1 from public.hotel_memberships m where m.hotel_id=p_hotel_id and m.user_id=auth.uid() and m.active and m.role=any(p_roles));
$$;

alter table public.hotel_payroll_items add column if not exists napsa_employer numeric(14,2) not null default 0 check(napsa_employer>=0);
alter table public.hotel_payroll_items add column if not exists nhima_employer numeric(14,2) not null default 0 check(nhima_employer>=0);
alter table public.hotel_payroll_items add column if not exists skills_development_levy numeric(14,2) not null default 0 check(skills_development_levy>=0);

drop policy if exists hotel_payroll_audit_hr_finance_update on public.hotel_payroll_audit;
drop policy if exists hotel_payroll_audit_hr_finance_insert on public.hotel_payroll_audit;
create policy hotel_payroll_audit_hr_finance_insert on public.hotel_payroll_audit for insert to authenticated with check(public.hotel_payroll_authorized(hotel_id,array['owner','manager','accountant']));
drop policy if exists hotel_payroll_items_hr_finance_delete_draft on public.hotel_payroll_items;
create policy hotel_payroll_items_hr_finance_delete_draft on public.hotel_payroll_items for delete to authenticated using(public.hotel_payroll_authorized(hotel_id,array['owner','manager','accountant']) and exists(select 1 from public.hotel_payroll_runs r where r.id=payroll_run_id and r.hotel_id=hotel_id and r.status='draft'));
grant delete on public.hotel_payroll_items to authenticated;
drop policy if exists hotel_payroll_runs_hr_finance_update on public.hotel_payroll_runs;
create policy hotel_payroll_runs_hr_finance_update on public.hotel_payroll_runs for update to authenticated using(public.hotel_payroll_authorized(hotel_id,array['owner','manager','accountant']) and status='draft') with check(public.hotel_payroll_authorized(hotel_id,array['owner','manager','accountant']) and status='draft');
drop policy if exists hotel_payroll_items_hr_finance_update on public.hotel_payroll_items;
create policy hotel_payroll_items_hr_finance_update on public.hotel_payroll_items for update to authenticated using(public.hotel_payroll_authorized(hotel_id,array['owner','manager','accountant']) and exists(select 1 from public.hotel_payroll_runs r where r.id=payroll_run_id and r.hotel_id=hotel_id and r.status='draft')) with check(public.hotel_payroll_authorized(hotel_id,array['owner','manager','accountant']) and exists(select 1 from public.hotel_payroll_runs r where r.id=payroll_run_id and r.hotel_id=hotel_id and r.status='draft'));
drop trigger if exists hotel_payroll_runs_updated_at on public.hotel_payroll_runs;
create trigger hotel_payroll_runs_updated_at before update on public.hotel_payroll_runs for each row execute function public.set_updated_at();

create or replace function public.hotel_approve_payroll(p_hotel_id uuid,p_run_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.hotel_payroll_runs%rowtype; a uuid:=auth.uid();
begin
 if a is null or not public.hotel_payroll_authorized(p_hotel_id,array['owner','manager','accountant']) then raise exception 'Not authorised to approve payroll'; end if;
 select * into r from public.hotel_payroll_runs where id=p_run_id and hotel_id=p_hotel_id for update;
 if not found then raise exception 'Payroll run not found'; end if;
 if r.status not in ('draft','reviewed') then raise exception 'Only draft/reviewed payroll can be approved'; end if;
 if r.prepared_by=a then raise exception 'Preparer cannot approve their own payroll'; end if;
 if not exists(select 1 from public.hotel_payroll_items where hotel_id=p_hotel_id and payroll_run_id=p_run_id) then raise exception 'Payroll has no employee lines'; end if;
 if exists(select 1 from public.hotel_payroll_items i where i.hotel_id=p_hotel_id and i.payroll_run_id=p_run_id and abs(i.gross_pay-i.net_pay-i.paye-i.napsa_employee-i.nhima_employee-i.other_deductions)>0.01) then raise exception 'Payroll line arithmetic failed validation'; end if;
 update public.hotel_payroll_runs set status='approved',approved_by=a,approved_at=now() where id=p_run_id;
 insert into public.hotel_payroll_audit(hotel_id,payroll_run_id,actor_user_id,action,details) values(p_hotel_id,p_run_id,a,'approved',jsonb_build_object('gross_total',r.gross_total,'net_total',r.net_total));
 return jsonb_build_object('ok',true,'run_id',p_run_id,'status','approved');
end $$;

create or replace function public.hotel_post_payroll(p_hotel_id uuid,p_run_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.hotel_payroll_runs%rowtype; a uuid:=auth.uid(); e uuid; ac uuid; ln record;
g numeric(14,2); n numeric(14,2); t numeric(14,2); ne numeric(14,2); he numeric(14,2); o numeric(14,2); ner numeric(14,2); her numeric(14,2); sdl numeric(14,2); diff numeric(14,2);
begin
 if a is null or not public.hotel_payroll_authorized(p_hotel_id,array['owner','accountant']) then raise exception 'Only owner/accountant may post payroll'; end if;
 select * into r from public.hotel_payroll_runs where id=p_run_id and hotel_id=p_hotel_id for update;
 if not found then raise exception 'Payroll run not found'; end if;
 if r.status='posted' then raise exception 'Payroll already posted'; end if;
 if r.status<>'approved' then raise exception 'Payroll must be approved before posting'; end if;
 if r.approved_by=a then raise exception 'Approver cannot post the same payroll'; end if;
 if exists(select 1 from public.hotel_journal_entries where hotel_id=p_hotel_id and source_type='payroll_run' and source_id=p_run_id) then raise exception 'Payroll journal already exists'; end if;
 select coalesce(sum(gross_pay),0),coalesce(sum(net_pay),0),coalesce(sum(paye),0),coalesce(sum(napsa_employee),0),coalesce(sum(nhima_employee),0),coalesce(sum(other_deductions),0),coalesce(sum(napsa_employer),0),coalesce(sum(nhima_employer),0),coalesce(sum(skills_development_levy),0)
 into g,n,t,ne,he,o,ner,her,sdl from public.hotel_payroll_items where hotel_id=p_hotel_id and payroll_run_id=p_run_id;
 if not exists(select 1 from public.hotel_payroll_items where hotel_id=p_hotel_id and payroll_run_id=p_run_id) then raise exception 'Payroll has no lines'; end if;
 if abs(g-n-t-ne-he-o)>0.01 then raise exception 'Payroll totals do not balance'; end if;
 perform public.hotel_ensure_default_accounts(p_hotel_id);
 insert into public.hotel_accounts(hotel_id,code,name,account_type) values
 (p_hotel_id,'6100','Salaries and wages expense','expense'),(p_hotel_id,'6110','Employer NAPSA expense','expense'),(p_hotel_id,'6120','Employer NHIMA expense','expense'),(p_hotel_id,'6130','Skills Development Levy expense','expense'),
 (p_hotel_id,'2100','Net salaries payable','liability'),(p_hotel_id,'2110','PAYE payable','liability'),(p_hotel_id,'2120','NAPSA payable','liability'),(p_hotel_id,'2130','NHIMA payable','liability'),(p_hotel_id,'2140','Skills Development Levy payable','liability'),(p_hotel_id,'2150','Other payroll deductions payable','liability') on conflict(hotel_id,code) do nothing;
 insert into public.hotel_journal_entries(hotel_id,entry_date,reference,description,source_type,source_id,status,created_by) values(p_hotel_id,r.payroll_month,'PAYROLL-'||r.run_number,'Monthly payroll '||to_char(r.payroll_month,'YYYY-MM'),'payroll_run',p_run_id,'posted',a) returning id into e;
 for ln in select code,amount from (values ('6100',g),('6110',ner),('6120',her),('6130',sdl),('2100',-n),('2110',-t),('2120',-(ne+ner)),('2130',-(he+her)),('2140',-sdl),('2150',-o)) q(code,amount) where amount<>0 loop
 select id into ac from public.hotel_accounts where hotel_id=p_hotel_id and code=ln.code and active;
 if ln.amount>0 then insert into public.hotel_journal_lines(hotel_id,entry_id,account_id,description,debit,credit) values(p_hotel_id,e,ac,'Payroll '||to_char(r.payroll_month,'YYYY-MM'),ln.amount,0);
 else insert into public.hotel_journal_lines(hotel_id,entry_id,account_id,description,debit,credit) values(p_hotel_id,e,ac,'Payroll '||to_char(r.payroll_month,'YYYY-MM'),0,abs(ln.amount)); end if;
 end loop;
 select coalesce(sum(debit),0)-coalesce(sum(credit),0) into diff from public.hotel_journal_lines where entry_id=e and hotel_id=p_hotel_id;
 if abs(diff)>0.01 then raise exception 'Generated payroll journal is unbalanced by %',diff; end if;
 update public.hotel_payroll_runs set status='posted',posted_by=a,posted_at=now() where id=p_run_id;
 insert into public.hotel_payroll_audit(hotel_id,payroll_run_id,actor_user_id,action,details) values(p_hotel_id,p_run_id,a,'posted',jsonb_build_object('journal_entry_id',e,'gross',g,'net',n,'paye',t,'napsa_employee',ne,'nhima_employee',he,'employer_napsa',ner,'employer_nhima',her,'sdl',sdl));
 return jsonb_build_object('ok',true,'run_id',p_run_id,'journal_entry_id',e,'status','posted','debits',g+ner+her+sdl,'credits',g+ner+her+sdl);
end $$;

create or replace view public.hotel_payroll_monthly_report with (security_invoker=true) as
select r.hotel_id,r.id payroll_run_id,r.payroll_month,r.run_number,r.status,r.currency_code,count(i.id)::integer employee_count,
coalesce(sum(i.gross_pay),0)::numeric(14,2) gross_total,coalesce(sum(i.paye),0)::numeric(14,2) paye_total,
coalesce(sum(i.napsa_employee),0)::numeric(14,2) napsa_employee_total,coalesce(sum(i.nhima_employee),0)::numeric(14,2) nhima_employee_total,
coalesce(sum(i.napsa_employer),0)::numeric(14,2) napsa_employer_total,coalesce(sum(i.nhima_employer),0)::numeric(14,2) nhima_employer_total,
coalesce(sum(i.skills_development_levy),0)::numeric(14,2) sdl_total,coalesce(sum(i.other_deductions),0)::numeric(14,2) other_deductions_total,
coalesce(sum(i.net_pay),0)::numeric(14,2) net_total,r.posted_at,r.approved_at
from public.hotel_payroll_runs r left join public.hotel_payroll_items i on i.hotel_id=r.hotel_id and i.payroll_run_id=r.id
group by r.hotel_id,r.id,r.payroll_month,r.run_number,r.status,r.currency_code,r.posted_at,r.approved_at;
grant select on public.hotel_payroll_monthly_report to authenticated;
revoke all on function public.hotel_payroll_authorized(uuid,text[]) from public,anon;
revoke all on function public.hotel_approve_payroll(uuid,uuid) from public,anon;
revoke all on function public.hotel_post_payroll(uuid,uuid) from public,anon;
grant execute on function public.hotel_approve_payroll(uuid,uuid) to authenticated;
grant execute on function public.hotel_post_payroll(uuid,uuid) to authenticated;
