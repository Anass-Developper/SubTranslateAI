# Privacy

The official SubTranslateAI Windows app is designed for local processing.

## Data flow

- Subtitle text is sent by the browser extension to the local service at `127.0.0.1`.
- The local service sends it to Ollama at a localhost endpoint.
- Translations and cache metadata may be stored locally in SQLite to avoid repeated work.
- SubTranslateAI does not include analytics, advertising or telemetry.
- A diagnostic report leaves the computer only when the user explicitly copies and shares it.

The installer needs internet access to download Ollama, the Hy-MT2 model and application updates. GitHub and the relevant model distribution services will receive normal network metadata such as the requesting IP address during those downloads.

## Local files

The desktop application stores its settings, extension copy, local cache and diagnostic state under its application-data directory. Uninstalling the application may intentionally keep user data so an update or reinstall does not lose settings.

## Browser permissions

The extension requests localhost access for translation. Supported video websites are handled by content scripts. Additional website access is optional and must be granted by the user through the browser.

Review the source and [security policy](../SECURITY.md) before using SubTranslateAI in a sensitive environment.
