# In-app updates

Open **Help → Check for updates**, **Settings → About**, or search for **Check for app updates** in the command palette.

1. Check for a release. Tributary compares versions and selects the exact platform and architecture.
2. Download it inside the app. Progress and cancellation are available. Both the release SHA-256 manifest and GitHub asset digest (when supplied) must agree with the downloaded bytes.
3. Save your edits, stop running agents/checks/debugging/previews and room hosting, then choose **Open installer**. Follow the system installer and reopen Tributary. Project data stays in its existing location.

Windows uses the NSIS `.exe`, macOS uses the `.dmg`, and Linux uses the `.deb`. An AppImage session instead downloads its matching AppImage and reveals the verified file for manual replacement after closing the app. Linux systems without a Debian package installer can use the release downloads instead.

**Private GitHub repository:** expand **GitHub access** and supply your own fine-grained personal access token with **Contents: read** permission for `DarkWorldCoder/tributary`. The account must have repository access. The token is encrypted using the existing OS credential protection; without a usable OS keychain it lasts only for the session. It is never bundled with the app, written to update preferences, passed to agents, or sent to the download CDN. Remove it in the same panel. Browser downloads remain available when you prefer to sign in on GitHub.

Automatic checks are opt-in, delayed 30 seconds after launch, then repeated every six hours. They notify without downloading, installing, quitting, or interrupting work. Source checkouts support manual checks and downloads; automatic checks are reserved for packaged apps.

## Publishing

The existing Distribution workflow publishes all six builds, their release assets and `SHA256SUMS.txt` together. Each release must use a new, increasing version and matching `v` tag. Drafts are excluded; the current preview channel includes published prereleases. No new update server or shared credential is required. Do not remove or replace assets on an existing version.

The updater is included starting with **0.1.2**. Users on **0.1.1** must install **0.1.2** once manually to receive these controls.

## Scope

This is an explicit, verified **download → system installer** flow. It does not silently replace a running app. macOS preview builds are ad-hoc signed, so seamless native Mac updates require a Developer ID signing/notarization setup first. Public, unattended distribution should also add signed update metadata and Windows code signing; an HTTPS checksum from the same release verifies integrity, not publisher identity. Existing Gatekeeper/SmartScreen prompts still apply.
