# SifoBooks Hotel

Independent hotel property-management application for hotels, lodges and guest houses. Built with React, TypeScript, Vite and Supabase.

## Product isolation
- Repository: `pritchardsikazwe/sifobooks-hotel-`
- Dedicated Supabase project: `fotnafyrjawypbsttplf` (EU West).
- The existing SifoBooks production app/database is not modified by this standalone app.
- Zambia defaults: ZMW and `Africa/Lusaka`.

## Implemented application workflows
- Email registration/sign-in and first-time hotel setup.
- Room types and room inventory.
- Guest directory and reservation book.
- Database-atomic reservation + folio creation; database guard prevents overlapping active bookings.
- Check-in/check-out/cancellation transitions, including idempotent room-stay charge posting.
- Guest folios, discount-aware balances, payment validation, receipt history and printable payment receipts.
- Housekeeping tasks and maintenance requests.
- Night audit with cash variance and daily audit history.
- Staff invitations through a server-side Supabase Edge Function, role assignment, suspension/restoration, and tenant-scoped RLS.
- Operational reports for booked nights, occupancy, charges, discounts, receipts, refunds and revenue by charge type.
- Property contact details and VAT configuration.
- Version-controlled SQL migrations and GitHub Actions build/deploy workflows.

## Local development
1. Install Node.js 22+ and npm.
2. The app defaults to its dedicated Supabase URL and public publishable key. You can override these using `.env.local` variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. Never put a Supabase service-role key in browser code or GitHub.
4. Run `npm install`, then `npm run dev`.
5. Verify with `npm run build`.

## Deployment
A GitHub Pages workflow now builds and deploys the static app from `main`. GitHub Actions status: https://github.com/pritchardsikazwe/sifobooks-hotel-/actions.

The custom domain file is `public/CNAME` for `hotel.sifobooks.com`. To make that address live, GitHub Pages must be enabled for this repository and DNS must point the subdomain to GitHub Pages. Configure the custom domain in repository Settings → Pages and enable HTTPS after DNS validation. Do not change SifoBooks production DNS.

After the site is live, set Supabase Authentication → URL Configuration:
- Site URL: `https://hotel.sifobooks.com`
- Redirect URL: `https://hotel.sifobooks.com/**`
Also add any local development URL used by the team.

## Important operational limitations before paid production
- Staff invitation emails redirect to `https://hotel.sifobooks.com`; configure that URL in Supabase Auth URL Configuration once the domain is enabled. Confirm that email delivery is configured and test an invitation end to end.
- VAT settings are configurable, but VAT invoice calculation, ZRA e-invoicing/VSDC, and posting to SifoBooks accounting are not yet integrated.
- Validate registration, email confirmation, tenant isolation, booking conflict handling, check-in/out, payments/refunds, night audit and recovery with a dedicated test account before onboarding paying hotels.
- Configure and test Supabase backups/PITR, recovery procedures, alerting and a rollback process.
- The app has not been independently audited or certified as a production PMS.
