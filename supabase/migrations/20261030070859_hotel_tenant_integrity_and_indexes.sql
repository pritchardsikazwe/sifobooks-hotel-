-- Tenant integrity and supporting indexes from the applied Hotel migration history.
-- Composite tenant foreign keys are defined in the core schema migration.
create index if not exists hotels_owner_user_id_idx on public.hotels(owner_user_id);
create index if not exists hotel_memberships_user_active_idx on public.hotel_memberships(user_id,active);
create index if not exists rooms_room_type_id_idx on public.rooms(room_type_id);
create index if not exists room_types_hotel_active_idx on public.room_types(hotel_id,active);
create index if not exists rooms_hotel_status_idx on public.rooms(hotel_id,status);
create index if not exists reservations_guest_id_idx on public.reservations(guest_id);
create index if not exists reservations_created_by_idx on public.reservations(created_by);
create index if not exists folio_items_folio_idx on public.folio_items(folio_id);
create index if not exists folio_items_hotel_idx on public.folio_items(hotel_id);
create index if not exists hotel_audit_events_hotel_created_idx on public.hotel_audit_events(hotel_id,created_at desc);
create index if not exists housekeeping_tasks_hotel_status_idx on public.housekeeping_tasks(hotel_id,status);
create index if not exists maintenance_requests_hotel_status_idx on public.maintenance_requests(hotel_id,status);
