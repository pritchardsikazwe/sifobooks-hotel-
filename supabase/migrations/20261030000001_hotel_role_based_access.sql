-- Restrict writes by hotel role while allowing all active members to read their tenant records.
do $$
declare
  t text;
  write_roles text[];
  role_sql text;
  tables text[] := array['room_types','rooms','guests','reservations','folios','folio_items','payments','housekeeping_tasks','maintenance_requests','night_audits'];
begin
  foreach t in array tables loop
    execute format('drop policy if exists %I on public.%I', t || '_members_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_members_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_members_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_members_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_members_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (exists (select 1 from public.hotel_memberships hm where hm.hotel_id = %I.hotel_id and hm.user_id = (select auth.uid()) and hm.active))', t || '_members_read', t, t);
    if t in ('room_types','rooms') then
      write_roles := array['owner','manager'];
    elsif t in ('guests','reservations','folios','folio_items','payments') then
      write_roles := array['owner','manager','receptionist','accountant'];
    elsif t = 'housekeeping_tasks' then
      write_roles := array['owner','manager','housekeeping'];
    elsif t = 'maintenance_requests' then
      write_roles := array['owner','manager','maintenance'];
    else
      write_roles := array['owner','manager','accountant'];
    end if;
    select string_agg(quote_literal(r), ',') into role_sql from unnest(write_roles) as r;
    execute format('create policy %I on public.%I for insert to authenticated with check (exists (select 1 from public.hotel_memberships hm where hm.hotel_id = %I.hotel_id and hm.user_id = (select auth.uid()) and hm.active and hm.role in (%s)))', t || '_members_insert', t, t, role_sql);
    execute format('create policy %I on public.%I for update to authenticated using (exists (select 1 from public.hotel_memberships hm where hm.hotel_id = %I.hotel_id and hm.user_id = (select auth.uid()) and hm.active and hm.role in (%s))) with check (exists (select 1 from public.hotel_memberships hm where hm.hotel_id = %I.hotel_id and hm.user_id = (select auth.uid()) and hm.active and hm.role in (%s)))', t || '_members_update', t, t, role_sql, t, role_sql);
    execute format('create policy %I on public.%I for delete to authenticated using (exists (select 1 from public.hotel_memberships hm where hm.hotel_id = %I.hotel_id and hm.user_id = (select auth.uid()) and hm.active and hm.role in (''owner'',''manager'')))', t || '_members_delete', t, t);
  end loop;
end $$;
