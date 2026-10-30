-- Replace the exposed SECURITY DEFINER onboarding RPC with an insert trigger.
-- The trigger function is not executable by API roles; it runs only from the hotels insert trigger.
drop function if exists public.create_hotel_for_current_user(text);

create or replace function public.attach_hotel_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.hotel_memberships (hotel_id,user_id,role,active)
  values (new.id,new.owner_user_id,'owner',true)
  on conflict (hotel_id,user_id) do nothing;
  return new;
end;
$$;

revoke all on function public.attach_hotel_owner_membership() from public;
revoke all on function public.attach_hotel_owner_membership() from anon;
revoke all on function public.attach_hotel_owner_membership() from authenticated;

drop trigger if exists hotels_create_owner_membership on public.hotels;
create trigger hotels_create_owner_membership
after insert on public.hotels
for each row execute function public.attach_hotel_owner_membership();

create policy "authenticated users can create own hotels" on public.hotels
for insert to authenticated with check (owner_user_id = (select auth.uid()));
grant insert on public.hotels to authenticated;
