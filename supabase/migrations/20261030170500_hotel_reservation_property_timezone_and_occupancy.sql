-- Align reservation validation with each property's configured timezone and occupancy rules.
create or replace function public.create_hotel_reservation(
 p_hotel_id uuid,p_guest_id uuid,p_room_id uuid,p_check_in date,p_check_out date,
 p_adults integer default 1,p_children integer default 0,p_nightly_rate numeric default null
) returns jsonb
language plpgsql security definer set search_path = public, auth
as $function$
declare
 uid uuid := auth.uid();
 h public.hotels%rowtype;
 rm public.rooms%rowtype;
 rt public.room_types%rowtype;
 r public.reservations;
 f public.folios;
 rate numeric;
begin
 if uid is null then raise exception 'Authentication required'; end if;
 select * into h from public.hotels where id=p_hotel_id;
 if not found then raise exception 'Property not found'; end if;
 if not exists(select 1 from public.hotel_memberships hm where hm.hotel_id=p_hotel_id and hm.user_id=uid and hm.active and hm.role in ('owner','manager','receptionist')) then raise exception 'You do not have permission to create reservations'; end if;
 if p_check_in is null or p_check_out is null or p_check_out<=p_check_in then raise exception 'Check-out must be after check-in'; end if;
 if p_check_in < (now() at time zone coalesce(nullif(h.timezone,''),'UTC'))::date then raise exception 'Check-in cannot be in the past'; end if;
 if coalesce(p_adults,0)<1 or coalesce(p_children,0)<0 then raise exception 'Guest count is invalid'; end if;
 if not exists(select 1 from public.guests g where g.id=p_guest_id and g.hotel_id=p_hotel_id) then raise exception 'Guest does not belong to this property'; end if;
 select * into rm from public.rooms where id=p_room_id and hotel_id=p_hotel_id and active and status not in ('maintenance','out_of_service');
 if not found then raise exception 'Room is inactive or unavailable'; end if;
 select * into rt from public.room_types where id=rm.room_type_id and hotel_id=p_hotel_id and active;
 if not found then raise exception 'Room type is inactive'; end if;
 if p_adults+p_children>rt.max_occupancy then raise exception 'Guest count exceeds room type maximum occupancy'; end if;
 rate:=coalesce(p_nightly_rate,rt.base_rate);
 if rate is null or rate<0 then raise exception 'Nightly rate must be zero or more'; end if;
 insert into public.reservations(hotel_id,reservation_number,guest_id,room_id,check_in_date,check_out_date,adults,children,nightly_rate,currency_code,status,created_by)
 values(p_hotel_id,'HT-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),p_guest_id,p_room_id,p_check_in,p_check_out,p_adults,p_children,rate,h.currency_code,'confirmed',uid)
 returning * into r;
 insert into public.folios(hotel_id,reservation_id,folio_number)
 values(p_hotel_id,r.id,'F-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))) returning * into f;
 return jsonb_build_object('reservation',to_jsonb(r),'folio',to_jsonb(f));
end;
$function$;
