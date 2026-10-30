# SifoHotel onboarding, transaction and validation checklist

**Environment:** SifoBooks Hotel Supabase project `fotnafyrjawypbsttplf`  
**Workspace:** SifoHotel Test Company  
**Purpose:** QA only. All seeded names, email addresses, references, payments and transactions are synthetic. This workspace must not be treated as a real hotel ledger or ZRA-fiscalised company.

## Seeded test dataset

- 3 room types and 4 rooms (occupied, available, dirty, maintenance)
- 3 synthetic guest profiles
- 3 reservations (checked-in, confirmed, checked-out)
- 3 guest folios, 4 folio charge lines (room charge, food & beverage, discount)
- 2 posted sample payments (cash and mobile money)
- 2 housekeeping tasks
- 1 maintenance ticket
- 3 POS inventory products
- 1 closed night-audit record
- All sample rows are labelled with `DEMO-` references or `SYNTHETIC TEST RECORD` notes where supported.

## Recommended first-run onboarding

1. Create/confirm the owner account and verify the email.
2. Create the property profile. Confirm legal name, phone, email, address, city, ZMW, Africa/Lusaka, check-in/out times and tax settings.
3. Configure room types, occupancy and rates, then add rooms and mark out-of-service rooms correctly.
4. Configure staff and least-privilege roles; verify a cashier can see only the POS workspace.
5. Add guests and create a reservation. Confirm the room is not double-booked and the reservation creates exactly one folio.
6. Check in the guest; post room, restaurant and other charges; record partial and full payments; verify the remaining balance and print receipt.
7. Test cancellation, check-out, refunds, discounts, invalid amounts, duplicate submission and reservation overlap.
8. Create housekeeping and maintenance tasks and confirm blocked rooms cannot be sold.
9. Open POS shift, sell test items using cash/card/mobile money, verify stock decrement and receipt totals, declare cash-in/out, close shift and check variance.
10. Run night audit and compare room charges, other charges, receipts and counted cash. Export reports and compare totals to underlying transactions.
11. Test document templates and print/PDF layouts.
12. Configure ZRA only with valid credentials and use the approved UAT process. Do not claim fiscalisation until the actual VSDC payload adapter, UAT and approval are complete.

## Validation status

### Verified in database
- SifoHotel workspace is present.
- Seeded counts: 3 room types, 4 rooms, 3 guests, 3 reservations, 3 folios, 4 charge lines, 2 payments, 2 housekeeping tasks, 1 maintenance ticket, 3 POS inventory items, 1 night audit.
- The database returned these records after seeding.

### Database tests completed in this pass
- Default chart of 11 accounts created for the SifoHotel test property.
- Seeded folio charges and receipts backfilled into the double-entry journal: 6 journal entries / 12 journal lines.
- Debits total ZMW 7,945.00 and credits total ZMW 7,945.00; 0 unbalanced journal entries.
- Trial-balance and profit-and-loss views created with invoker security so property access remains governed by row-level security.
- POS checkout now calls a database RPC that validates cashier role, shift, item activity and stock, and posts the sale, sale lines and stock deduction in one database transaction.

### Not yet verified end-to-end
- Browser/UI flows, build and deployment.
- Complete booking overlap and concurrency protection.
- Transaction-safe POS posting and stock deduction under failures/concurrent checkouts.
- Accounting ledger postings, trial balance, balance sheet, profit & loss and audit trail. The current app's Reports page is an operational summary, not a full double-entry accounting ledger.
- Real ZRA fiscalisation. The current connector path has previously been identified as not yet configured to send the final fiscal invoice payload; do not use demo records for tax submission.
- Cashier invitations are not fully ready: the invitation function's server-side role allowlist previously omitted the new POS cashier roles, so role creation must be validated before production use.

## Release gate

Do not use this workspace for live financial reporting or ZRA submission. Before go-live, run automated tests against a staging database, fix the gaps above, verify RLS with owner/manager/receptionist/accountant/cashier test accounts, confirm backups and recovery, and reconcile all reports to independently calculated expected values.
