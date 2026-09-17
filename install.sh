#!/usr/bin/env bash
# Local development install for the OpenCode Go Usage extension.
set -euo pipefail

UUID="opencode-go-usage@iamohd"
DEST="${HOME}/.local/share/gnome-shell/extensions/${UUID}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Installing to ${DEST}"
rm -rf "${DEST}"
mkdir -p "${DEST}"
cp -r \
    "${HERE}/extension.js" \
    "${HERE}/prefs.js" \
    "${HERE}/stylesheet.css" \
    "${HERE}/metadata.json" \
    "${HERE}/lib" \
    "${HERE}/schemas" \
    "${DEST}/"

glib-compile-schemas "${DEST}/schemas/"

echo "Installed. Restart GNOME Shell (X11: Alt+F2 -> r) or log out/in (Wayland),"
echo "then enable with:"
echo "    gnome-extensions enable ${UUID}"