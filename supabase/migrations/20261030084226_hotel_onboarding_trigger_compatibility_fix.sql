-- The hotels_create_owner_membership trigger creates the owner membership; do not insert it twice.
create or replace function public.create_hotel_for_current_user(p_name text)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare uid uuid:=auth.uid(); created_hotel public.hotels;
begin
 if uid is null then raise exception 'Authentication is required' using errcode='28000'; end if;
 if p_name is null or length(trim(p_name))<2 or length(trim(p_name))>160 then raise exception 'Hotel name must be between 2 and 160 characters' using errcode='22023'; end if;
 if exists(select 1 from public.hotels h where h.owner_user_id=uid) or exists(select 1 from public.hotel_memberships hm where hm.user_id=uid and hm.active) then raise exception 'This account already belongs to a hotel workspace' using errcode='23505'; end if;
 insert into public.hotels(owner_user_id,name,country,currency_code,timezone) values(uid,trim(p_name),'Zambia','ZMW','Africa/Lusaka') returning * into created_hotel;
 return to_jsonb(created_hotel);
end; $$;
revoke all on function public.create_hotel_for_current_user(text) from public,anon;
grant execute on function public.create_hotel_for_current_user(text) to authenticated;