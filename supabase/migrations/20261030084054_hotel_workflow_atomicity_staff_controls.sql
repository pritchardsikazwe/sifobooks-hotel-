-- Transactional reservation, check-in/check-out, payment and staff RPCs.
create or replace function public.create_hotel_reservation(
 p_hotel_id uuid,p_guest_id uuid,p_room_id uuid,p_check_in date,p_check_out date,
 p_adults integer default 1,p_children integer default 0,p_nightly_rate numeric default null
) returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare uid uuid:=auth.uid(); r public.reservations; f public.folios; rate numeric;
begin
 if uid is null then raise exception 'Authentication required'; end if;
 if not exists(select 1 from public.hotel_memberships hm where hm.hotel_id=p_hotel_id and hm.user_id=uid and hm.active and hm.role in ('owner','manager','receptionist')) then raise exception 'You do not have permission to create reservations'; end if;
 if p_check_in is null or p_check_out is null or p_check_out<=p_check_in then raise exception 'Check-out must be after check-in'; end if;
 if p_check_in<(now() at time zone 'Africa/Lusaka')::date then raise exception 'Check-in cannot be in the past'; end if;
 if coalesce(p_adults,0)<1 or coalesce(p_children,0)<0 then raise exception 'Guest count is invalid'; end if;
 if not exists(select 1 from public.guests g where g.id=p_guest_id and g.hotel_id=p_hotel_id) then raise exception 'Guest does not belong to this hotel'; end if;
 select rt.base_rate into rate from public.rooms rm join public.room_types rt on rt.id=rm.room_type_id and rt.hotel_id=rm.hotel_id where rm.id=p_room_id and rm.hotel_id=p_hotel_id and rm.active and rt.active and rm.status not in ('maintenance','out_of_service');
 if not found then raise exception 'Room is inactive or unavailable'; end if;
 rate:=coalesce(p_nightly_rate,rate); if rate<0 then raise exception 'Nightly rate cannot be negative'; end if;
 insert into public.reservations(hotel_id,reservation_number,guest_id,room_id,check_in_date,check_out_date,adults,children,nightly_rate,currency_code,status,created_by)
 select p_hotel_id,'HT-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),p_guest_id,p_room_id,p_check_in,p_check_out,p_adults,p_children,rate,h.currency_code,'confirmed',uid from public.hotels h where h.id=p_hotel_id returning * into r;
 insert into public.folios(hotel_id,reservation_id,folio_number) values(p_hotel_id,r.id,'F-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))) returning * into f;
 return jsonb_build_object('reservation',to_jsonb(r),'folio',to_jsonb(f));
end; $$;
revoke all on function public.create_hotel_reservation(uuid,uuid,uuid,date,date,integer,integer,numeric) from public,anon;
grant execute on function public.create_hotel_reservation(uuid,uuid,uuid,date,date,integer,integer,numeric) to authenticated;

create or replace function public.transition_hotel_reservation(p_reservation_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare uid uuid:=auth.uid(); r public.reservations; f public.folios; room_no text; nights integer;
begin
 select * into r from public.reservations where id=p_reservation_id for update;
 if not found then raise exception 'Reservation not found'; end if;
 if uid is null or not exists(select 1 from public.hotel_memberships hm where hm.hotel_id=r.hotel_id and hm.user_id=uid and hm.active and hm.role in ('owner','manager','receptionist')) then raise exception 'You do not have permission to change this reservation'; end if;
 if p_action='checkin' then
  if r.status<>'confirmed' then raise exception 'Only confirmed reservations can be checked in'; end if;
  update public.reservations set status='checked_in',checked_in_at=now() where id=r.id returning * into r;
  update public.rooms set status='occupied' where id=r.room_id and hotel_id=r.hotel_id;
  select * into f from public.folios where reservation_id=r.id and hotel_id=r.hotel_id order by opened_at limit 1;
  if found then
   select room_number into room_no from public.rooms where id=r.room_id and hotel_id=r.hotel_id; nights:=r.check_out_date-r.check_in_date;
   if not exists(select 1 from public.folio_items where folio_id=f.id and reference='room-stay:'||r.id::text) then
    insert into public.folio_items(hotel_id,folio_id,item_type,description,quantity,unit_price,amount,service_date,reference,posted_by)
    values(r.hotel_id,f.id,'room_charge','Room '||coalesce(room_no,'')||' · '||nights||' night(s)',nights,r.nightly_rate,nights*r.nightly_rate,r.check_in_date,'room-stay:'||r.id::text,uid);
   end if;
  end if;
 elsif p_action='checkout' then
  if r.status<>'checked_in' then raise exception 'Only checked-in reservations can be checked out'; end if;
  update public.reservations set status='checked_out',checked_out_at=now() where id=r.id returning * into r;
  update public.rooms set status='dirty' where id=r.room_id and hotel_id=r.hotel_id;
 elsif p_action='cancel' then
  if r.status not in ('pending','confirmed') then raise exception 'Only pending or confirmed reservations can be cancelled'; end if;
  update public.reservations set status='cancelled',cancelled_at=now() where id=r.id returning * into r;
 else raise exception 'Unsupported reservation action'; end if;
 return to_jsonb(r);
end; $$;
revoke all on function public.transition_hotel_reservation(uuid,text) from public,anon;
grant execute on function public.transition_hotel_reservation(uuid,text) to authenticated;

create or replace function public.record_hotel_payment(p_hotel_id uuid,p_folio_id uuid,p_method text,p_amount numeric,p_reference text default null)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare uid uuid:=auth.uid(); f public.folios; total_charges numeric; total_payments numeric; p public.payments;
begin
 if uid is null then raise exception 'Authentication required'; end if;
 if p_amount is null or p_amount<=0 then raise exception 'Payment amount must be greater than zero'; end if;
 if p_method not in ('cash','card','bank_transfer','mobile_money','voucher','other') then raise exception 'Invalid payment method'; end if;
 if not exists(select 1 from public.hotel_memberships hm where hm.hotel_id=p_hotel_id and hm.user_id=uid and hm.active and hm.role in ('owner','manager','receptionist','accountant')) then raise exception 'You do not have permission to record payments'; end if;
 select * into f from public.folios where id=p_folio_id and hotel_id=p_hotel_id for update;
 if not found or f.status<>'open' then raise exception 'Open folio not found'; end if;
 select coalesce(sum(amount),0) into total_charges from public.folio_items where folio_id=f.id and hotel_id=p_hotel_id;
 select coalesce(sum(case when payment_type='refund' then -amount else amount end),0) into total_payments from public.payments where folio_id=f.id and hotel_id=p_hotel_id and status='posted';
 if p_amount>greatest(0,total_charges-total_payments)+0.005 then raise exception 'Payment exceeds the outstanding folio balance'; end if;
 insert into public.payments(hotel_id,folio_id,reservation_id,payment_number,payment_type,method,amount,currency_code,reference,received_by)
 select p_hotel_id,f.id,f.reservation_id,'RC-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),'receipt',p_method,p_amount,h.currency_code,nullif(trim(p_reference),''),uid from public.hotels h where h.id=p_hotel_id returning * into p;
 return to_jsonb(p);
end; $$;
revoke all on function public.record_hotel_payment(uuid,uuid,text,numeric,text) from public,anon;
grant execute on function public.record_hotel_payment(uuid,uuid,text,numeric,text) to authenticated;

create or replace function public.list_hotel_members(p_hotel_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,auth as $$
declare uid uuid:=auth.uid(); result jsonb;
begin
 if uid is null or not exists(select 1 from public.hotel_memberships hm where hm.hotel_id=p_hotel_id and hm.user_id=uid and hm.active and hm.role in ('owner','manager')) then raise exception 'Only hotel owners/managers can view staff'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',hm.id,'user_id',hm.user_id,'email',u.email,'role',hm.role,'active',hm.active,'created_at',hm.created_at) order by hm.created_at),'[]'::jsonb) into result
 from public.hotel_memberships hm join auth.users u on u.id=hm.user_id where hm.hotel_id=p_hotel_id;
 return result;
end; $$;
revoke all on function public.list_hotel_members(uuid) from public,anon;
grant execute on function public.list_hotel_members(uuid) to authenticated;

create or replace function public.add_hotel_member_by_email(p_hotel_id uuid,p_email text,p_role text)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare uid uuid:=auth.uid(); target uuid; result public.hotel_memberships;
begin
 if uid is null or not exists(select 1 from public.hotel_memberships hm where hm.hotel_id=p_hotel_id and hm.user_id=uid and hm.active and hm.role='owner') then raise exception 'Only the hotel owner can add staff'; end if;
 if p_role not in ('manager','receptionist','housekeeping','accountant','maintenance','viewer') then raise exception 'Invalid staff role'; end if;
 if p_email is null or trim(p_email)='' then raise exception 'Enter the staff member email'; end if;
 select id into target from auth.users where lower(email)=lower(trim(p_email)) and email_confirmed_at is not null limit 1;
 if target is null then raise exception 'No confirmed account found for that email. Ask the staff member to register and confirm their email first.'; end if;
 if target=uid then raise exception 'You are already the hotel owner'; end if;
 insert into public.hotel_memberships(hotel_id,user_id,role,active) values(p_hotel_id,target,p_role,true)
 on conflict(hotel_id,user_id) do update set role=excluded.role,active=true returning * into result;
 return jsonb_build_object('id',result.id,'user_id',result.user_id,'role',result.role,'active',result.active);
end; $$;
revoke all on function public.add_hotel_member_by_email(uuid,text,text) from public,anon;
grant execute on function public.add_hotel_member_by_email(uuid,text,text) to authenticated;

create or replace function public.set_hotel_member_active(p_hotel_id uuid,p_membership_id uuid,p_active boolean)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare uid uuid:=auth.uid(); result public.hotel_memberships;
begin
 if uid is null or not exists(select 1 from public.hotel_memberships hm where hm.hotel_id=p_hotel_id and hm.user_id=uid and hm.active and hm.role='owner') then raise exception 'Only the hotel owner can manage staff'; end if;
 update public.hotel_memberships set active=p_active where id=p_membership_id and hotel_id=p_hotel_id and role<>'owner' returning * into result;
 if not found then raise exception 'Staff membership not found'; end if;
 return to_jsonb(result);
end; $$;
revoke all on function public.set_hotel_member_active(uuid,uuid,boolean) from public,anon;
grant execute on function public.set_hotel_member_active(uuid,uuid,boolean) to authenticated;

create unique index if not exists folio_items_room_stay_reference_uidx on public.folio_items(hotel_id,reference) where reference like 'room-stay:%';
create index if not exists hotel_memberships_hotel_role_idx on public.hotel_memberships(hotel_id,role,active);
