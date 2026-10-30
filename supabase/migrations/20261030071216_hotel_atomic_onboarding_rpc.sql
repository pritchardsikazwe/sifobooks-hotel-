-- Create the first hotel and its owner membership atomically.
-- Direct client INSERT into hotels is revoked; onboarding must use this checked RPC.
create or replace function public.create_hotel_for_current_user(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
  created_hotel public.hotels;
begin
  if uid is null then
    raise exception 'Authentication is required' using errcode = '28000';
  end if;
  if p_name is null or length(trim(p_name)) < 2 or length(trim(p_name)) > 160 then
    raise exception 'Hotel name must be between 2 and 160 characters' using errcode = '22023';
  end if;
  if exists (select 1 from public.hotels h where h.owner_user_id = uid)
     or exists (select 1 from public.hotel_memberships hm where hm.user_id = uid and hm.active) then
    raise exception 'This account already belongs to a hotel workspace' using errcode = '23505';
  end if;
  insert into public.hotels (owner_user_id, name, country, currency_code, timezone)
  values (uid, trim(p_name), 'Zambia', 'ZMW', 'Africa/Lusaka')
  returning * into created_hotel;
  insert into public.hotel_memberships (hotel_id, user_id, role, active)
  values (created_hotel.id, uid, 'owner', true);
  return to_jsonb(created_hotel);
end;
$$;
revoke all on function public.create_hotel_for_current_user(text) from public;
revoke all on function public.create_hotel_for_current_user(text) from anon;
grant execute on function public.create_hotel_for_current_user(text) to authenticated;
drop policy if exists "authenticated users can create own hotels" on public.hotels;
revoke insert on public.hotels from authenticated;
