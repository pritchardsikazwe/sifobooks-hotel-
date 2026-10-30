# Tauri desktop shell

This shell packages the existing secure hosted Supabase-backed hotel application as a Windows installer. It is not an offline database and does not embed privileged Supabase credentials. ZRA VSDC access is provided by the separate customer-controlled Windows connector, not by exposing a local VSDC port to the public internet.

Build locally with Rust and WebView2 installed: `npm install && npm run tauri:build`. GitHub Actions produces unsigned installer artifacts; signing certificate configuration is needed for trusted signed distribution.
