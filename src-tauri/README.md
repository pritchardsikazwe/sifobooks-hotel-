# SifoBooks Hotel desktop runtime

The Tauri shell now initialises a per-user SQLite database in the OS application-data directory. It enables WAL and foreign keys, applies a versioned bootstrap schema, and exposes local runtime status and company create/list commands to the desktop UI. Company creation and its sync-outbox event are committed in one SQLite transaction.

## Current implementation boundary

Implemented: local SQLite bootstrap, company profile storage and validation, durable sync outbox for locally created companies, and Tauri commands for local status and company listing/creation.

Not yet implemented or production-ready: migration of all hotel operational tables from Supabase to SQLite; offline login, staff identities and role enforcement; LAN HTTP server, pairing, TLS/authentication and firewall setup; full transaction sync and conflict resolution; cloud backup/restore; signed offline licence verification; and cloud-to-local data migration. The hosted React application still uses Supabase. Do not represent this foundation as full offline hotel operations until all remaining modules are ported and tested. No service-role key is embedded in the desktop application.
