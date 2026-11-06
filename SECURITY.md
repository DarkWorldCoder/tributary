# Security

Tributary is preview software that can operate on local files and run commands through agents and project tools. Choose permission modes deliberately and review requested actions. An agent's own provider, CLI, extension and MCP services have their own settings and security boundaries.

## Reporting

Do not put credentials, private source, unredacted transcripts or a working exploit against another person's system in a public issue. Use GitHub's private vulnerability reporting option if it is enabled for this repository; otherwise contact a repository maintainer through an existing private channel before sharing sensitive details. No dedicated security email or response-time guarantee is advertised.

For non-sensitive bugs, open an issue with the app version, operating system, affected feature and minimal sanitized reproduction. Keep project `.env` values and API keys out of screenshots and attachments.

## Current boundaries

- Installers are preview builds, without developer signing/notarization. Verify checksums from the release you downloaded.
- App data and project files are distinct. Removing the app keeps project folders; optional data cleanup is documented in [uninstall instructions](docs/UNINSTALL.md).
- OS credential protection depends on the platform/keychain being available. Inspect Settings before assuming a saved key is encrypted persistently.
- Local-model weights and inference live in the configured runtime. A local connection does not make every selected provider local.
- Room hosting is explicit and stops when hosting is stopped or the app closes. Share invitation/access details only with intended teammates.

[More implementation notes](docs/GUIDE.md#security-notes) · [Team secrets](docs/GUIDE.md#team-secrets)
