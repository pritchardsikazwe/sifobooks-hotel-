-- Applied to Supabase project fotnafyrjawypbsttplf as hotel_guest_portal_availability_and_input_hardening.
-- Keep this migration source-controlled so fresh environments receive the same safeguards.
create index if not exists hotel_guest_requests_hotel_created_idx on public.hotel_guest_requests (hotel_id, created_at desc);
create index if not exists hotel_guest_messages_hotel_created_idx on public.hotel_guest_messages (hotel_id, created_at desc);
create index if not exists reservations_hotel_room_dates_active_idx on public.reservations (hotel_id, room_id, check_in_date, check_out_date) where status not in ('cancelled','no_show');
create index if not exists rooms_hotel_room_type_status_idx on public.rooms (hotel_id, room_type_id, status, active);

create or replace function public.get_guest_portal(p_hotel_id uuid, p_check_in date default current_date, p_check_out date default (current_date + 1))
returns jsonb language plpgsql security definer set search_path = public as $function$
declare h public.hotels%rowtype; result jsonb;
begin
 if p_hotel_id is null then raise exception 'Property identifier is required.'; end if;
 if p_check_in is null or p_check_out is null or p_check_out <= p_check_in or p_check_out > p_check_in + 60 then raise exception 'Choose a valid stay up to 60 nights.'; end if;
 select * into h from public.hotels where id=p_hotel_id;
 if not found then raise exception 'Property not found.'; end if;
 select jsonb_build_object(
  'hotel',jsonb_build_object('id',h.id,'name',h.name,'city',h.city,'address',h.address,'phone',h.phone,'email',h.email,'check_in_time',h.check_in_time,'check_out_time',h.check_out_time,'currency_code',coalesce(nullif(trim(h.currency_code::text),''),'USD')),
  'room_types',coalesce((select jsonb_agg(jsonb_build_object('id',rt.id,'name',rt.name,'description',rt.description,'base_rate',rt.base_rate,'max_occupancy',rt.max_occupancy,'available_rooms',(select count(*) from public.rooms r where r.hotel_id=h.id and r.room_type_id=rt.id and r.active and r.status not in ('maintenance','out_of_service') and not exists(select 1 from public.reservations rv where rv.hotel_id=h.id and rv.room_id=r.id and rv.status not in ('cancelled','no_show','checked_out') and rv.check_in_date<p_check_out and rv.check_out_date>p_check_in))) from public.room_types rt where rt.hotel_id=h.id and rt.active),'[]'::jsonb)
 ) into result;
 return result;
end $function$;

create or replace function public.submit_guest_message(p_hotel_id uuid,p_guest_name text,p_guest_contact text,p_room_number text,p_message text)
returns uuid language plpgsql security definer set search_path = public as $function$
declare new_id uuid;
begin
 if length(trim(coalesce(p_guest_name,'')))<2 or length(trim(coalesce(p_guest_name,'')))>120 or length(trim(coalesce(p_message,'')))<2 or length(trim(coalesce(p_message,'')))>3000 then raise exception 'Enter a valid name and a message of 2 to 3000 characters.'; end if;
 if length(coalesce(p_guest_contact,''))>160 or length(coalesce(p_room_number,''))>80 then raise exception 'Contact details or room number is too long.'; end if;
 if not exists(select 1 from public.hotels where id=p_hotel_id) then raise exception 'Property not found.'; end if;
 insert into public.hotel_guest_messages(hotel_id,guest_name,guest_contact,room_number,message) values(p_hotel_id,trim(p_guest_name),nullif(trim(coalesce(p_guest_contact,'')),''),nullif(trim(coalesce(p_room_number,'')),''),trim(p_message)) returning id into new_id;
 return new_id;
end $function$;

create or replace function public.submit_guest_request(p_hotel_id uuid,p_guest_name text,p_guest_contact text,p_room_number text,p_request_type text,p_details text,p_quantity integer default 1)
returns uuid language plpgsql security definer set search_path = public as $function$
declare new_id uuid;
begin
 if length(trim(coalesce(p_guest_name,'')))<2 or length(trim(coalesce(p_guest_name,'')))>120 or length(trim(coalesce(p_details,'')))<2 or length(trim(coalesce(p_details,'')))>2000 then raise exception 'Enter a valid name and request details (2 to 2000 characters).'; end if;
 if length(coalesce(p_guest_contact,''))>160 or length(coalesce(p_room_number,''))>80 then raise exception 'Contact details or room number is too long.'; end if;
 if p_request_type not in ('food','laundry','housekeeping','maintenance','amenities','other') then raise exception 'Invalid request type.'; end if;
 if p_quantity is null or p_quantity<1 or p_quantity>100 then raise exception 'Quantity must be between 1 and 100.'; end if;
 if not exists(select 1 from public.hotels where id=p_hotel_id) then raise exception 'Property not found.'; end if;
 insert into public.hotel_guest_requests(hotel_id,guest_name,guest_contact,room_number,request_type,details,quantity) values(p_hotel_id,trim(p_guest_name),nullif(trim(coalesce(p_guest_contact,'')),''),nullif(trim(coalesce(p_room_number,'')),''),p_request_type,trim(p_details),p_quantity) returning id into new_id;
 return new_id;
end $function$;
