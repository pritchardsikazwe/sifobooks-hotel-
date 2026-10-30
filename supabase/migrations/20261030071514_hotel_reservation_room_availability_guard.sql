create or replace function public.prevent_room_double_booking()
returns trigger language plpgsql set search_path = public
as $$
declare room_status text; room_is_active boolean;
begin
  if new.status in ('pending','confirmed','checked_in') then
    select r.status,r.active into room_status,room_is_active from public.rooms r where r.id=new.room_id and r.hotel_id=new.hotel_id;
    if not found then raise exception 'Room does not belong to this hotel' using errcode='23503'; end if;
    if not room_is_active or room_status in ('maintenance','out_of_service') then raise exception 'This room is inactive or unavailable for sale' using errcode='23514'; end if;
    perform pg_advisory_xact_lock(hashtextextended(new.room_id::text,0));
    if exists (select 1 from public.reservations r where r.room_id=new.room_id and r.id<>coalesce(new.id,'00000000-0000-0000-0000-000000000000'::uuid) and r.status in ('pending','confirmed','checked_in') and daterange(r.check_in_date,r.check_out_date,'[)') && daterange(new.check_in_date,new.check_out_date,'[)')) then
      raise exception 'Room is already reserved for part or all of these dates' using errcode='23P01';
    end if;
  end if;
  return new;
end;
$$;
