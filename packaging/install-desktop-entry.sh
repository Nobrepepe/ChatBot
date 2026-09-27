#!/usr/bin/env bash
# Installs (or refreshes) the Character Chat desktop entry and icon for the
# current user, so the app can be launched from the application menu and
# pinned to the taskbar. Re-run it after moving the project directory.
#
#   ./packaging/install-desktop-entry.sh             install
#   ./packaging/install-desktop-entry.sh --uninstall remove

set -euo pipefail

here="$(cd -- "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")" && pwd)"
project_root="$(dirname -- "$here")"

app_id="character-chat"
wm_class="character-chat"
data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
apps_dir="$data_home/applications"
icons_dir="$data_home/icons/hicolor"
desktop_file="$apps_dir/$app_id.desktop"
sizes=(16 24 32 48 64 128 256 512)

refresh_caches() {
    command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$apps_dir" >/dev/null 2>&1 || true
    command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -f -t "$icons_dir" >/dev/null 2>&1 || true
    command -v kbuildsycoca6 >/dev/null 2>&1 && kbuildsycoca6 --noincremental >/dev/null 2>&1 || true
}

if [[ "${1:-}" == "--uninstall" ]]; then
    rm -f "$desktop_file"
    rm -f "$icons_dir/scalable/apps/$app_id.svg"
    for size in "${sizes[@]}"; do
        rm -f "$icons_dir/${size}x${size}/apps/$app_id.png"
    done
    refresh_caches
    echo "Removed the Character Chat desktop entry and icon."
    exit 0
fi

mkdir -p "$apps_dir" "$icons_dir/scalable/apps"
install -m 644 "$here/$app_id.svg" "$icons_dir/scalable/apps/$app_id.svg"

# Raster copies for panels and menus that will not scale an SVG themselves.
# rsvg-convert first; ImageMagick covers a machine without librsvg.
raster_with() {
    for size in "${sizes[@]}"; do
        mkdir -p "$icons_dir/${size}x${size}/apps"
        "$@" "$size" "$here/$app_id.svg" "$icons_dir/${size}x${size}/apps/$app_id.png" || return 1
    done
}
rsvg() { rsvg-convert -w "$1" -h "$1" "$2" -o "$3"; }
imagemagick() { magick -background none -density 384 "$2" -resize "$1x$1" "$3"; }

if command -v rsvg-convert >/dev/null 2>&1; then
    raster_with rsvg
elif command -v magick >/dev/null 2>&1; then
    raster_with imagemagick
else
    echo "Note: no rasteriser found (rsvg-convert or ImageMagick); installed the SVG icon only." >&2
fi

chmod +x "$here/$app_id"
sed -e "s|@EXEC@|$here/$app_id|g" \
    -e "s|@PROJECT_ROOT@|$project_root|g" \
    -e "s|@WMCLASS@|$wm_class|g" \
    "$here/$app_id.desktop.in" > "$desktop_file"
chmod 644 "$desktop_file"

command -v desktop-file-validate >/dev/null 2>&1 && desktop-file-validate "$desktop_file"
refresh_caches

echo "Installed:"
echo "  $desktop_file"
echo "  $icons_dir/scalable/apps/$app_id.svg"
echo
echo "Search for \"Character Chat\" in the application launcher, then right-click"
echo "the running window's task manager entry and choose \"Pin to Task Manager\"."
