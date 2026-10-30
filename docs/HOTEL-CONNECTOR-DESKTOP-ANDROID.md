# SifoBooks Hotel local connector and desktop/mobile packaging

## Connector design

The ZRA connector is a separate Windows service/agent, not code embedded in the browser:
Hotel web app -> authenticated server-side queue -> customer-controlled Windows connector -> local ZRA VSDC -> ZRA.

The agent must:
- run as a Windows service or tray application and reconnect with backoff;
- use a one-time-issued connector credential, store it using Windows DPAPI/credential storage, and never log secrets;
- poll only its assigned hotel/device commands over outbound HTTPS (no inbound public port);
- validate tenant/device identity and environment on every command;
- forward only approved VSDC operations to the locally configured VSDC endpoint;
- report heartbeat, VSDC reachability, command result and redacted diagnostics;
- enforce idempotency, persist a local retry journal, and avoid duplicate fiscal submissions;
- support test mode by default and require explicit operator enablement for production;
- never bypass ZRA validation, invent item/tax/unit codes, or alter an accepted fiscal invoice.

## Windows standalone app

The current hotel project is a React/Vite web app. A copied `dist` folder is a portable web bundle, **not** a native Windows standalone EXE. A true Windows installer/EXE needs a desktop wrapper (recommended Tauri 2 or WebView2/Electron), native build configuration, connector packaging, and Windows build testing. Do not distribute the web bundle as if it were an EXE.

## Android APK/AAB

APK is suitable for direct installation/testing; AAB is the Google Play upload format. The current repository has no native Android wrapper/project or release signing setup, so it cannot safely produce a real APK/AAB yet. Configure Tauri 2 Android or Capacitor, a unique application ID, app icons, deep links/redirect URLs, permissions, offline/error handling, and Android signing secrets in GitHub Actions before producing signed release builds. Never commit keystore files or passwords.

## Release checklist

1. Implement and test the server-side hotel connector registration, command queue, heartbeat and event ingestion endpoints.
2. Build a Windows agent with secure credential storage, signed installer, service lifecycle and local VSDC configuration UI.
3. Complete sandbox tests for sales, receipt/fiscal reference, retries, duplicate prevention and supported credit notes.
4. Add Tauri/Capacitor native project and run builds on CI.
5. Set GitHub Actions secrets for Android signing only after generating the key securely; store backups offline.
6. Verify artifacts, version numbers, app identity and installation/upgrade behavior before release.
