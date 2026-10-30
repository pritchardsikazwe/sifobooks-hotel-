-- Public guest portal, messaging and service requests for QR-based hotel access.
create table if not exists public.hotel_guest_messages (
 id uuid primary key default gen_random_uuid(), hotel_id uuid not null references public.hotels(id) on delete cascade,
 guest_name text not null, guest_contact text, room_number text, message text not null,
 sender_type text not null default 'guest' check(sender_type in ('guest','staff')),
 status text not null default 'open' check(status in ('open','replied','closed')),
 reply text, replied_by uuid references auth.users(id), replied_at timestamptz,
 created_at timestamptz not null default now()
);
create table if not exists public.hotel_guest_requests (
 id uuid primary key default gen_random_uuid(), hotel_id uuid not null references public.hotels(id) on delete cascade,
 guest_name text not null, guest_contact text, room_number text,
 request_type text not null check(request_type in ('food','laundry','housekeeping','maintenance','amenities','other')),
 details text not null, quantity integer not null default 1 check(quantity>0),
 status text not null default 'received' check(status in ('received','accepted','in_progress','completed','declined')),
 staff_notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.hotel_guest_messages enable row level security;
alter table public.hotel_guest_requests enable row level security;
create policy hotel_guest_messages_staff on public.hotel_guest_messages for all to authenticated using (exists(select 1 from public.hotel_memberships hm where hm.hotel_id=hotel_guest_messages.hotel_id and hm.user_id=(select auth.uid()) and hm.active)) with check (exists(select 1 from public.hotel_memberships hm where hm.hotel_id=hotel_guest_messages.hotel_id and hm.user_id=(select auth.uid()) and hm.active));
create policy hotel_guest_requests_staff on public.hotel_guest_requests for all to authenticated using (exists(select 1 from public.hotel_memberships hm where hm.hotel_id=hotel_guest_requests.hotel_id and hm.user_id=(select auth.uid()) and hm.active)) with check (exists(select 1 from public.hotel_memberships hm where hm.hotel_id=hotel_guest_requests.hotel_id and hm.user_id=(select auth.uid()) and hm.active));
grant select,insert,update,delete on public.hotel_guest_messages,public.hotel_guest_requests to authenticated;
-- Public functions expose only the minimum hotel details, room-type prices and date-specific availability.
create or replace function public.get_guest_portal(p_hotel_id uuid, p_check_in date default current_date, p_check_out date default current_date + 1)
returns jsonb language plpgsql security definer set search_path=public as $$
declare h public.hotels%rowtype; result jsonb;
begin
 if p_check_out <= p_check_in or p_check_out > p_check_in + 60 then raise exception 'Choose a valid stay up to 60 nights.'; end if;
 select * into h from public.hotels where id=p_hotel_id;
 if not found then raise exception 'Hotel not found.'; end if;
 select jsonb_build_object(
  'hotel',jsonb_build_object('id',h.id,'name',h.name,'city',h.city,'address',h.address,'phone',h.phone,'email',h.email,'check_in_time',h.check_in_time,'check_out_time',h.check_out_time,'currency_code',coalesce(h.currency_code,'ZMW')),
  'room_types',coalesce((select jsonb_agg(jsonb_build_object('id',rt.id,'name',rt.name,'description',rt.description,'base_rate',rt.base_rate,'max_occupancy',rt.max_occupancy,'available_rooms',(select count(*) from public.rooms r where r.hotel_id=h.id and r.room_type_id=rt.id and r.status not in ('maintenance','out_of_order') and not exists(select 1 from public.reservations rv where rv.hotel_id=h.id and rv.room_id=r.id and rv.status not in ('cancelled','no_show') and rv.check_in_date<p_check_out and rv.check_out_date>p_check_in)))) from public.room_types rt where rt.hotel_id=h.id),'[]'::jsonb)
 ) into result;
 return result;
end $$;
grant execute on function public.get_guest_portal(uuid,date,date) to anon,authenticated;
create or replace function public.submit_guest_request(p_hotel_id uuid,p_guest_name text,p_guest_contact text,p_room_number text,p_request_type text,p_details text,p_quantity integer default 1)
returns uuid language plpgsql security definer set search_path=public as $$
declare new_id uuid;
begin
 if length(trim(coalesce(p_guest_name,'')))<2 or length(trim(coalesce(p_details,'')))<2 then raise exception 'Enter your name and request details.'; end if;
 if p_request_type not in ('food','laundry','housekeeping','maintenance','amenities','other') then raise exception 'Invalid request type.'; end if;
 if p_quantity<1 or p_quantity>100 then raise exception 'Quantity must be between 1 and 100.'; end if;
 if not exists(select 1 from public.hotels where id=p_hotel_id) then raise exception 'Hotel not found.'; end if;
 insert into public.hotel_guest_requests(hotel_id,guest_name,guest_contact,room_number,request_type,details,quantity)
 values(p_hotel_id,trim(p_guest_name),nullif(trim(coalesce(p_guest_contact,'')),''),nullif(trim(coalesce(p_room_number,'')),''),p_request_type,trim(p_details),p_quantity) returning id into new_id;
 return new_id;
end $$;
grant execute on function public.submit_guest_request(uuid,text,text,text,text,text,integer) to anon,authenticated;
create or replace function public.submit_guest_message(p_hotel_id uuid,p_guest_name text,p_guest_contact text,p_room_number text,p_message text)
returns uuid language plpgsql security definer set search_path=public as $$
declare new_id uuid;
begin
 if length(trim(coalesce(p_guest_name,'')))<2 or length(trim(coalesce(p_message,'')))<2 then raise exception 'Enter your name and message.'; end if;
 if not exists(select 1 from public.hotels where id=p_hotel_id) then raise exception 'Hotel not found.'; end if;
 insert into public.hotel_guest_messages(hotel_id,guest_name,guest_contact,room_number,message)
 values(p_hotel_id,trim(p_guest_name),nullif(trim(coalesce(p_guest_contact,'')),''),nullif(trim(coalesce(p_room_number,'')),''),trim(p_message)) returning id into new_id;
 return new_id;
end $$;
grant execute on function public.submit_guest_message(uuid,text,text,text,text) to anon,authenticated;
