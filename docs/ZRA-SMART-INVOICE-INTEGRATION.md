# Hotel ZRA Smart Invoice integration

## Reference implementation

SifoBooks already contains the VSDC integration building blocks in the main repository:
- `src/lib/zra/payloads.ts` — transaction payload construction (classification/unit/tax codes must be supplied, not guessed).
- `src/lib/zra/connector.server.ts` and `src/lib/zra/connector-routing.server.ts` — server-side connector routing/control.
- `src/lib/zra/vsdc.ts` — VSDC client logic.
- `docs/SIFOBOOKS-CLOUD-VSDC-CONNECTOR.md` — connector security and control-plane design.
- `cloud/migrations/012_lovable_cloud_zra_fiscalization.sql` and `013_lovable_cloud_zra_connector.sql` — existing SifoBooks data model reference.

## Hotel-specific model

The hotel project stores its own configuration and submission history in:
- `hotel_zra_settings`
- `hotel_zra_submissions`
- `hotel_zra_events`

These are separate hotel-tenant records. Do not copy another company's TPIN, branch/device credentials, connector credentials, or production fiscal identifiers. No secrets belong in browser storage or Vite environment variables.

## Submission lifecycle

1. An authorised hotel user posts an invoice/POS transaction in the hotel's own transaction system.
2. A server-side adapter validates required customer/item classification, unit and tax codes, amount totals, environment, and tenant ownership.
3. A stable idempotency key is created from the source transaction and document type. A retry must reuse the same key.
4. The transaction is queued and sent through that hotel's registered VSDC connector.
5. Store a minimal redacted request/response summary and ZRA's returned fiscal reference, signature and QR/receipt data when available.
6. Accepted submissions are immutable. Corrections use supported credit/debit note or reversal flows, never silent edits.
7. Failed submissions show the returned error and retry only when safe. Never automatically switch a production transaction to test or resubmit with a new idempotency key.

## Hotel transaction mapping

- Room charges / folio invoice: eligible accommodation invoice items.
- Restaurant and bar POS: each eligible sale through the configured fiscal workflow.
- Events and conference invoices: eligible invoiced event/catering items.
- Refunds and invoice corrections: supported credit/debit note process.
- Purchases and stock movements: only where required by the current VSDC API and the hotel's approved integration scope.

Tax categories and item classification/unit codes must be configured against current ZRA item classification guidance. Do not blindly apply the tourism levy to all food and beverage sales. Use current official VSDC specification and ZRA guidance as the source of truth.

## Readiness / limitations

The migration creates secure tenant-scoped configuration and queue/history tables only. It does **not** itself submit transactions to ZRA or make the hotel app ZRA-certified. The server-side adapter, connector agent mapping, UI, sandbox tests, reconciliation tests, and ZRA UAT/certification process must be completed before production use. Test environment is the default. Production must require explicit enablement and a successful test/UAT checklist.
