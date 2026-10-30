# SifoBooks Hotel

Independent hotel property-management application for hotels, lodges and guest houses. Built with React, TypeScript, Vite and Supabase.

## Current status
- Standalone application source and build configuration.
- Dedicated Supabase project: `fotnafyrjawypbsttplf`.
- Zambia defaults: ZMW and `Africa/Lusaka`.
- Hotel workspace, room inventory, guests, reservations, check-in/check-out, folios, receipts, housekeeping, maintenance and night-audit foundation.
- Row-level security and database-level room-overlap protection.

## Local development
1. Install Node.js 22+ and npm.
2. Copy `.env.example` to `.env.local`.
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` using the project's URL and publishable/anon key. Never use a service-role key in browser code.
4. Run `npm install`.
5. Run `npm run dev`.
6. Verify with `npm run build`.

## Database
SQL migrations are in `supabase/migrations/`. Review migration order and confirm the target project before applying changes. The connected project currently has the Hotel schema deployed; migrations should be tracked consistently before production release.

## Deployment
The app is not yet deployed. Configure environment variables, build checks, hosting, the `hotel.sifobooks.com` custom domain, TLS and Supabase Auth redirect URLs after choosing the hosting provider. Do not point DNS to an unprovisioned host.

## Production readiness
This is an in-progress foundation, not yet a certified production PMS. Complete build verification, end-to-end tests for authentication/reservations/folio balances/receipts/night audit, backups, monitoring, and a deployment rollback plan before onboarding paying hotels.
