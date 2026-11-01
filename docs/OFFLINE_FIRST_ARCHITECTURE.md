# SifoBooks Hotel offline-first architecture

## Product modes
1. Standalone: one Windows computer runs the desktop client, local services and SQLite database. It operates without internet after installation and licence provisioning.
2. Local network: one designated Windows server hosts the database and authenticated application API. Other devices are thin clients over the private LAN. Clients never mount or write the SQLite file over SMB.
3. Cloud-connected: the local server remains authoritative for local operations and synchronises queued, idempotent changes to the cloud when connectivity returns.

## Data and sync contract
- Each installation and company has immutable UUID identifiers.
- Every local mutation is committed with an outbox event in the same SQLite transaction.
- Events carry event ID, entity type/ID, operation, schema version, payload and creation time.
- Cloud ingestion is idempotent on event ID and validates tenant/company ownership.
- Acknowledgements mark events synced; retries use backoff and cannot duplicate financial postings.
- Financial transactions are append-only and corrected by reversal/adjustment, never last-write-wins.
- Sync uses TLS and revocable device credentials. Never ship a Supabase service-role key in the desktop client.

## Offline licensing
Company creation and local operations must not require online validation. Licences are signed documents verified with an embedded public key; private signing keys remain on the licensing service. Claims include product, company UUID, installation UUID, edition, seats/devices, issue/expiry dates, features and licence ID. Activation is optional and exchanges an activation code for a signed licence. Expiry must not destroy or lock customer data; retain read/export access and a renewal path.

## LAN security
- Default standalone binds to loopback only.
- LAN mode binds only to private interfaces and requires administrator-enabled device pairing with short-lived one-time codes.
- Pairing issues revocable device credentials; every request requires authentication and role authorization.
- Use TLS or a managed trusted local certificate. Never expose unauthenticated HTTP.
- Windows Firewall rules are scoped to Private networks only.
- SQLite is accessed only by the server process, with WAL, foreign keys, busy timeout and verified backups.

## Database and recovery
SQLite is the local operational store; PostgreSQL/Supabase is the cloud store. Define database adapters and equivalent migrations. Port properties, users, memberships, rooms, guests, reservations, folios, payments, POS, inventory, payroll, journals, tax and audit before enabling offline transactions. Use UTC timestamps plus property IANA timezone. Backups must use SQLite's online backup API or a consistent checkpoint/copy strategy; encrypt sensitive backups and test restore regularly.

## Delivery gates
1. Desktop local foundation: SQLite bootstrap, company profile, outbox and health status. Foundation implemented in this branch.
2. Offline business engine: port all workflows and schema, local users/roles/audit, parity tests.
3. LAN mode: authenticated API, pairing, discovery, scoped firewall and concurrent-user tests.
4. Backup/migration: restore, cloud-to-local import, local-to-cloud initial seed and recovery drills.
5. Cloud sync: idempotent ingestion, acknowledgements, retries, conflicts and tenant isolation tests.
6. Licensing: signed offline licences, activation, grace period and seat-limit tests.
7. Release: signed installer, in-place update tests, migrations and pilot hotel acceptance.
A phase is not complete merely because it compiles; each gate needs automated and manual tests plus a recoverable backup.
