-- Keep room status consistent with housekeeping and maintenance even for limited-role staff.
create or replace function public.sync_hotel_room_operational_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_hotel uuid;
  target_room uuid;
begin
  if tg_table_name = 'housekeeping_tasks' then
    target_hotel := new.hotel_id;
    target_room := new.room_id;
    if tg_op = 'INSERT' then
      update public.rooms set status = 'dirty'
      where id = target_room and hotel_id = target_hotel and status not in ('maintenance','out_of_service');
    elsif new.status in ('completed','verified') and old.status is distinct from new.status then
      if not exists (select 1 from public.maintenance_requests m where m.hotel_id = target_hotel and m.room_id = target_room and m.blocks_room_sale and m.status not in ('completed','cancelled')) then
        update public.rooms set status = 'inspected'
        where id = target_room and hotel_id = target_hotel and status not in ('maintenance','out_of_service');
      end if;
    end if;
  elsif tg_table_name = 'maintenance_requests' then
    target_hotel := new.hotel_id;
    target_room := new.room_id;
    if target_room is not null then
      if new.blocks_room_sale and new.status not in ('completed','cancelled') then
        update public.rooms set status = 'maintenance'
        where id = target_room and hotel_id = target_hotel and status <> 'out_of_service';
      elsif new.status in ('completed','cancelled') and old.status is distinct from new.status
        and not exists (select 1 from public.maintenance_requests m where m.hotel_id = target_hotel and m.room_id = target_room and m.id <> new.id and m.blocks_room_sale and m.status not in ('completed','cancelled')) then
        update public.rooms set status = 'dirty'
        where id = target_room and hotel_id = target_hotel and status = 'maintenance';
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.sync_hotel_room_operational_status() from public;
revoke all on function public.sync_hotel_room_operational_status() from anon;
revoke all on function public.sync_hotel_room_operational_status() from authenticated;
drop trigger if exists housekeeping_sync_room_status on public.housekeeping_tasks;
create trigger housekeeping_sync_room_status after insert or update of status on public.housekeeping_tasks for each row execute function public.sync_hotel_room_operational_status();
drop trigger if exists maintenance_sync_room_status on public.maintenance_requests;
create trigger maintenance_sync_room_status after insert or update of status,blocks_room_sale,room_id on public.maintenance_requests for each row execute function public.sync_hotel_room_operational_status();
