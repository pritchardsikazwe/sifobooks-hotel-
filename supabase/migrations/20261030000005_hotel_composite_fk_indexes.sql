-- Composite indexes cover tenant-safe composite foreign keys. Remove redundant single-column duplicates.
drop index if exists public.payments_folio_idx;
drop index if exists public.payments_reservation_idx;
drop index if exists public.payments_received_by_idx;
create index if not exists rooms_hotel_room_type_idx on public.rooms(hotel_id,room_type_id);
create index if not exists folios_hotel_reservation_idx on public.folios(hotel_id,reservation_id);
create index if not exists folio_items_hotel_folio_idx on public.folio_items(hotel_id,folio_id);
create index if not exists payments_hotel_folio_idx on public.payments(hotel_id,folio_id);
create index if not exists payments_hotel_reservation_idx on public.payments(hotel_id,reservation_id);
create index if not exists housekeeping_hotel_room_idx on public.housekeeping_tasks(hotel_id,room_id);
create index if not exists maintenance_hotel_room_idx on public.maintenance_requests(hotel_id,room_id);
