# Platform implementation and deployment checklist

## Implemented in the repository

- Smart Invoice settings/history panel in the hotel navigation.
- Hotel-tenant scoped Smart Invoice tables and row-level security.
- Supabase Edge Function `hotel-zra-control` deployed to the dedicated SifoBooks Hotel Supabase project.
- One-time connector pairing token; only its SHA-256 digest is stored in hotel settings.
- Connector heartbeat, local VSDC reachability check, queue staging, idempotency key for folio invoice staging, submission history and controlled retry.
- A fail-closed Windows connector agent. It deliberately does not transmit fiscal transactions until a hotel-specific VSDC adapter is implemented and validated.
- Tauri 2 Windows installer configuration, Capacitor Android configuration, and a GitHub Actions workflow for Windows installers, connector executable, Android APK and AAB artifacts.

## Important ZRA boundary

The connector control plane is implemented, but **this is not yet end-to-end ZRA fiscalisation**. The agent currently reports `ADAPTER_NOT_CONFIGURED` for queued submissions. It does not send an invoice to VSDC and does not claim ZRA acceptance. The hotel-specific payload adapter still needs the current ZRA VSDC request/response mapping, taxpayer/device registration, classification/unit/tax codes, receipt/signature verification, correction flows, sandbox/UAT and reconciliation tests.

The Edge Function blocks production environment selection unless the server-side secret `ZRA_PRODUCTION_ENABLED=true` is explicitly set. Do not set it until ZRA UAT and release review are complete. The frontend must never contain service-role keys or taxpayer/device secrets.

## Apply / deploy

The migration was applied to the dedicated Supabase project `fotnafyrjawypbsttplf`; the `hotel-zra-control` Edge Function was deployed. To redeploy from a developer checkout, use the Supabase CLI with the project linked and the usual server environment variables configured. Never put the service-role key in GitHub source or Vite variables.

## Native build artifacts

Open GitHub Actions → **SifoBooks Hotel Desktop and Android Builds** → **Run workflow** and select:
- `all`: Windows installers, connector EXE, debug APK and release AAB
- `windows`: Windows MSI/EXE and connector EXE
- `android-apk`: debug APK
- `android-aab`: release AAB

Artifacts are unsigned unless signing credentials are configured. The AAB is not yet Google Play-ready signing. Configure Android signing secrets and a signing step before Play Console upload. Configure a Windows code-signing certificate before public installer distribution. GitHub Actions must finish successfully before artifacts are available.

## Install Windows connector

1. Download `HotelZraConnector.exe` from the workflow artifacts.
2. Create `C:\\ProgramData\\SifoBooksHotel\\connector.json` using `connector/windows/connector.example.json`.
3. Copy the one-time token from Hotel → ZRA Smart Invoice → Pair Windows connector.
4. Restrict the config file with Windows ACLs so only the connector service account and administrators can read it.
5. Start the connector interactively for initial heartbeat testing. Confirm the app shows the connector online and the expected local VSDC endpoint is reachable.
6. Do not configure it as a Windows service or use it to fiscalise sales until the approved VSDC adapter is complete.

## Android app behavior

The Android build wraps the hosted hotel app and uses the same Supabase-backed tenant data. It is not an offline-first native database. Test sign-in redirects, device rotation, downloads/printing, session expiry, deep links and permissions on a real device before distribution.
