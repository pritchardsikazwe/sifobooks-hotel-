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


## Windows printing and LAN diagnostics agent

The companion `print-network-agent.js` runs on the trusted Windows computer and binds only to `127.0.0.1:17890`. It provides:
- `GET /health` — local service health.
- `GET /printers` — installed Windows printers and default printer.
- `GET /network/info` — computer name and local IPv4 interfaces (not a public IP lookup).
- `GET /jobs` — recent local job states.
- `POST /print/text` — submit a plain-text job to the Windows print spooler.

### Build and run

From the repository root, install dependencies and run:
`npm run connector:print-network:build`
Then run `release\\SifoBooksHotelPrintNetwork.exe` on the Windows print host. For development, run `node connector/windows/print-network-agent.js` with Node.js 20+.

Test on that Windows computer:
- Open `http://127.0.0.1:17890/health`
- Open `http://127.0.0.1:17890/printers`
- Open `http://127.0.0.1:17890/network/info`

### Scope and safety

This is the local Windows integration foundation. It does not yet provide PDF/A4 or ESC/POS receipt printing, printer-role routing (front desk/receipt/kitchen/bar), LAN client discovery, or a cloud queue/retry dispatcher. Do not expose port 17890 to the LAN or internet. Browser origin checks are not authentication; use it only on a trusted machine until a device-pairing token and stronger local request validation are added. A successful response means the Windows spooler accepted the text job, not that paper physically printed.