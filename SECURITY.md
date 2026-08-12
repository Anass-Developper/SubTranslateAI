# Security policy

## Supported versions

Security fixes are provided for the latest published version of SubTranslateAI. Older releases may not receive patches.

## Reporting a vulnerability

Please do not disclose a vulnerability in a public issue.

Use GitHub's private vulnerability reporting form in the repository **Security** tab. Include:

- the affected version and component;
- steps to reproduce or a minimal proof of concept;
- the expected impact;
- any suggested mitigation, if you have one.

You should receive an acknowledgement within seven days. Please allow a reasonable remediation period before public disclosure.

## Security boundaries

The official desktop application runs its translation service on `127.0.0.1` and restricts Ollama to a localhost HTTP endpoint. It does not intentionally expose a network service to other computers. Browser pages from external origins are rejected by the local API.

Only download installers from the official [release repository](https://github.com/Anass-Developper/SubTranslateAI-Releases/releases). The Windows installer is not code-signed yet, so Windows may show a SmartScreen warning.
