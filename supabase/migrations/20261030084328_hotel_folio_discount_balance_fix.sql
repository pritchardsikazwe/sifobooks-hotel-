-- Discounts reduce the folio balance and must not inflate the allowed payment amount.
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
 select coalesce(sum(case when item_type='discount' then -abs(amount) else amount end),0) into total_charges from public.folio_items where folio_id=f.id and hotel_id=p_hotel_id;
 select coalesce(sum(case when payment_type='refund' then -amount else amount end),0) into total_payments from public.payments where folio_id=f.id and hotel_id=p_hotel_id and status='posted';
 if p_amount>greatest(0,total_charges-total_payments)+0.005 then raise exception 'Payment exceeds the outstanding folio balance'; end if;
 insert into public.payments(hotel_id,folio_id,reservation_id,payment_number,payment_type,method,amount,currency_code,reference,received_by)
 select p_hotel_id,f.id,f.reservation_id,'RC-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),'receipt',p_method,p_amount,h.currency_code,nullif(trim(p_reference),''),uid from public.hotels h where h.id=p_hotel_id returning * into p;
 return to_jsonb(p);
end; $$;
revoke all on function public.record_hotel_payment(uuid,uuid,text,numeric,text) from public,anon;
grant execute on function public.record_hotel_payment(uuid,uuid,text,numeric,text) to authenticated;