# SifoBooks Hotel Windows ZRA connector agent

This agent runs on the hotel's Windows computer and makes outbound HTTPS requests to the hotel's Supabase Edge Function. It never opens a public inbound port. The connector token is a bearer secret; store the config file with Windows ACLs limited to the service account and administrators.

## Setup for development / connector heartbeat validation

1. Deploy the `hotel-zra-control` Supabase Edge Function and apply the database migrations.
2. In Hotel → ZRA Smart Invoice, pair the connector and copy the one-time token.
3. Install Node.js 20 or newer on the trusted Windows machine.
4. Create `C:\\ProgramData\\SifoBooksHotel\\connector.json` from `connector.example.json`; fill in the project URL and token. Restrict file ACLs.
5. Run `node agent.js` from this directory and check the Smart Invoice page for an online heartbeat.

## Important limitation

This is a connector control-plane/heartbeat and local VSDC reachability agent, **not yet a production fiscalisation connector**. It deliberately returns `ADAPTER_NOT_CONFIGURED` for queued submissions and does not transmit invoice data to the VSDC. Before enabling real sales submission, implement and test the adapter against the current official ZRA VSDC specification, taxpayer device registration, tax/item/unit mappings, receipt/signature validation, idempotency, correction flows and UAT. Do not treat a reachable local port as proof that a fiscal sale is accepted. Do not run the agent as a Windows service until the adapter and recovery behavior have been reviewed.
