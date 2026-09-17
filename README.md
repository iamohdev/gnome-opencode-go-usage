# OpenCode Go Usage

GNOME Shell extension showing OpenCode Go API usage in the top panel: per-window progress bars, reset countdowns, threshold notifications, and a native preferences window.

Data comes from `GET https://opencode.ai/zen/go/v1/usage` with a `Bearer` API key.

## Features

- Panel indicator (`Go 67%`) for the most-used window, with optional reset countdown.
- Popup with progress bars, percentages, and reset countdowns for every window the API returns (5-hour, weekly, monthly — rendered dynamically).
- API key stored in the GNOME Secret Service (never plaintext, settings, logs, or cache).
- Cached usage when offline; clear auth, rate-limit, network, and malformed-response errors.
- Optional 80% / 90% / 100% notifications, fired once per reset.
- Configurable refresh interval, panel elements/mode, and visible quota windows.

## Requirements

- GNOME Shell 45–50
- `libsecret` + a running Secret Service (`gnome-keyring` on GNOME)
- An OpenCode Go subscription and API key (`https://opencode.ai/auth`)

## Install

```sh
./install.sh
# or: make package && gnome-extensions install --force dist/opencode-go-usage@iamohd.shell-extension.zip
gnome-extensions enable opencode-go-usage@iamohd
```

Restart the shell afterwards (X11: `Alt+F2` → `r`; Wayland: log out/in; new extensions load only after a fresh login). Logs: `journalctl -f -o cat /usr/bin/gnome-shell`.

## Configure

```sh
gnome-extensions prefs opencode-go-usage@iamohd
```

Paste your API key and press Enter — it is saved to the Secret Service, tested immediately, and picked up without a shell restart. Preferences also set refresh interval, panel content, visible windows, and notification thresholds. In the popup, **Refresh** forces a check, and a missing/invalid key offers **Open Preferences**.

## Development

```sh
make test     # unit tests
make check    # tests + syntax checks + schema validation
make package  # build dist/opencode-go-usage@iamohd.shell-extension.zip
```

## Privacy

The extension talks only to the OpenCode Go API; the key is sent solely as a `Bearer` token to `opencode.ai`. No analytics, telemetry, or third-party servers.

## License

GPL-2.0-or-later. See `LICENSE`.
