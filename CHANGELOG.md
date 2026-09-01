# Changelog

All notable user-facing changes are documented here.

## [Unreleased]

## [1.1.13] - 2026-09-01

- Accept established target-language equivalents for acronyms, such as translating `ONU` to `联合国`, instead of reporting the local translation service as unavailable.

## [1.1.12] - 2026-09-01

- Accept harmless capitalization changes when the local model normalizes acronyms such as `Nasa` to `NASA` in Chinese subtitles.

## [1.1.11] - 2026-08-31

- Translate complete subtitle sentences containing acronyms or technical codes while preserving those terms exactly.
- Automatically discard and repair older cached translations that incorrectly returned the source sentence unchanged.

## [1.1.10] - 2026-08-16

- Localized subtitle overlay error messages in French and English, including live updates after changing the interface language.

## [1.1.9] - 2026-08-15

- Localized the extension subtitle overlay's accessibility label and diagnostic controls in French and English.

## [1.1.8] - 2026-08-14

- Added a complete French and English Windows app interface with automatic system-language detection and a saved manual language choice.

## [1.1.7] - 2026-08-13

- Added a complete French and English extension interface with automatic browser-language detection and a saved manual language choice.

## [1.1.6] - 2026-08-12

- Fixed Windows trying to open the legacy `Ollama.lnk.disabled` file at login.
- Remove Ollama startup shortcuts after installation, on app startup and on shutdown.

## [1.1.5] - 2026-08-12

- Open-sourced the project under Apache-2.0.
- Added public security, privacy and contribution documentation.
- Made Ollama the default provider for development installs.
- Minimized setup errors persisted on disk and redacted personal paths from copied diagnostics.
- Added an integration test proving that the local API rate limit applies globally.

## [1.1.4] - 2026-08-09

- Removed transient model warm-up notifications and the subtitle accent bar.
- Kept subtitle display focused on the selected translated output.

## [1.1.3] - 2026-08-08

- Improved the extension popup and bilingual display controls.
- Added English subtitle input with French and Chinese output.
- Added an optional first-translation playback pause.
- Prevented visible and orphaned console windows during startup.

## [1.1.2] - 2026-08-08

- Improved live-subtitle synchronization and error handling.
- Added richer diagnostics for translation failures and latency.

## [1.1.1] - 2026-08-08

- Hardened automatic Ollama installation on Windows.
- Fixed translation settings controls.

## [1.1.0] - 2026-08-08

- Added the Windows control panel, guided setup and automatic updates.
- Added Ollama and Hy-MT2 installation support.
