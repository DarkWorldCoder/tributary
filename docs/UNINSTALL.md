# Uninstall Tributary

Quit Tributary first. Stop agents and **Stop hosting** if a project room is running.

| Platform / download | Remove the app |
| --- | --- |
| Windows `.exe` | **Settings → Apps → Installed apps → Tributary → Uninstall**. |
| Windows portable `.zip` | Close the app and delete its extracted folder and any shortcut you created. |
| macOS `.dmg` / `.zip` | In **Applications**, move **Tributary.app** to the Trash. Eject the mounted installer if it is still open. |
| Linux `.deb` | Use your software manager to remove **Tributary**, or run `sudo apt remove tributary`. |
| Linux AppImage | Delete the downloaded `.AppImage` and any launcher you created. |
| Linux `.tar.gz` | Delete the extracted app folder and any launcher you created. |

**Your project folders and repositories are not deleted.** Saved chats, settings and credentials are kept separately, so reinstalling can restore them. Uninstalling does not remove coding agents, Git or language tools you installed separately.

## Optional: remove saved app data

Back up any chats or settings you want before deleting app data. After quitting the app, remove only its **Tributary** (or **tributary**) folder under:

- **Windows:** `%APPDATA%`
- **macOS:** `~/Library/Application Support/`
- **Linux:** `${XDG_CONFIG_HOME:-~/.config}/`

A custom `TRIBUTARY_DATA_DIR` uses that location instead. Keep your project folders. If you used LAN hosting, its local owner key and room database are in the app-data folder too; removing them loses that hosted room’s history and access.

Deleting the app does not revoke a GitHub token. If you created a token for updates and no longer need it, revoke it in **GitHub → Settings → Developer settings → Personal access tokens**.
