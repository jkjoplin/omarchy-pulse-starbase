#!/bin/bash
# Omarchy Pulse · Starbase: a live wallpaper for Omarchy's Starship theme. Installs the engine (Omarchy Pulse with the
# Starbase scene), its packages, a user unit, the theme-set hook and the login start.
# Based on Omarchy Pulse's extras/install-live, (c) 2026 Marco Porro (x.com/MarcoPorro), MIT.
#   ./install.sh            set it up: live with the Starship theme (and the pulse theme)
#   ./install.sh --always   live with every Omarchy theme (they get Pulse's own scenes, in their colours)
#   ./install.sh --remove   undo it; an Omarchy Pulse that was installed before comes back as it was
set -e
here="$(cd "$(dirname "$0")" && pwd)"
share="$HOME/.local/share/omarchy-pulse"
bin="$HOME/.local/bin/omarchy-pulse"
hook_dir="$HOME/.config/omarchy/hooks/theme-set.d"
hook="$hook_dir/omarchy-pulse"
unit_dir="$HOME/.config/systemd/user"
unit="$unit_dir/omarchy-pulse.service"
desktop="$HOME/.config/autostart/omarchy-pulse.desktop"
cfg_dir="$HOME/.config/omarchy-pulse"
conf="$cfg_dir/live.conf"
backup_note="$cfg_dir/starbase-backup"   # where an earlier Omarchy Pulse was put aside

if [[ $EUID -eq 0 ]]; then echo "Run it as your own user, not root (it asks for sudo only to install packages)."; exit 1; fi

if [[ ${1:-} == --remove ]]; then
  systemctl --user stop omarchy-pulse.service 2>/dev/null || true
  old="$(cat "$backup_note" 2>/dev/null || true)"
  rm -rf "$share"
  if [[ -n $old && -d $old ]]; then
    mv "$old" "$share"
    rm -f "$backup_note"
    systemctl --user daemon-reload 2>/dev/null || true
    "$share/pulse-live" 2>/dev/null || true
    echo "Starbase removed. Your earlier Omarchy Pulse is back ($share)."
  else
    rm -f "$hook" "$desktop" "$unit" "$bin" "$conf" "$backup_note"
    systemctl --user daemon-reload 2>/dev/null || true
    echo "Starbase removed. Your sources are still in $cfg_dir (delete the folder to forget them)."
  fi
  exit 0
fi
case "${1:-}" in
  --always) mkdir -p "$cfg_dir"; echo "ALWAYS=1" > "$conf" ;;
  "") ;;
  *) echo "usage: ./install.sh [--always|--remove]"; exit 1 ;;
esac

command -v omarchy >/dev/null || command -v omarchy-theme-set >/dev/null || echo "Note: this does not look like Omarchy; it is made for Omarchy 4.5+."
[[ -n ${SSH_CONNECTION:-} ]] && echo "Note: run this from a terminal on the PC itself (not over SSH), so the wallpaper can start."

need=()
python3 -c "import gi" 2>/dev/null || need+=(python-gobject)
python3 -c "import gi; gi.require_version('GtkLayerShell','0.1')" 2>/dev/null || need+=(gtk-layer-shell)
python3 -c "import gi; gi.require_version('WebKit2','4.1')" 2>/dev/null || need+=(webkit2gtk-4.1)
command -v ffmpeg >/dev/null || need+=(ffmpeg)
command -v playerctl >/dev/null || need+=(playerctl)
if ((${#need[@]})); then
  echo "Installing: ${need[*]}"
  sudo pacman -S --needed --noconfirm "${need[@]}"
fi

systemctl --user stop omarchy-pulse.service 2>/dev/null || true
# an Omarchy Pulse installed before (from the pulse theme) is kept aside, not overwritten
if [[ -d $share && ! -f $share/.starbase && ! -f $backup_note ]]; then
  old="$share.before-starbase-$(date +%Y%m%d-%H%M%S)"
  mv "$share" "$old"
  mkdir -p "$cfg_dir"; echo "$old" > "$backup_note"
  echo "Your Omarchy Pulse is kept in $old (./install.sh --remove puts it back)."
fi

mkdir -p "$share" "$(dirname "$bin")" "$hook_dir" "$unit_dir" "$(dirname "$desktop")" "$cfg_dir/sources"
cp -r "$here/pulse/." "$share/"
install -m 755 "$here/pulse-live" "$share/pulse-live"
chmod +x "$share/omarchy-pulse" "$share"/sources/*
git -C "$here" rev-parse --short HEAD > "$share/.starbase" 2>/dev/null || echo "local" > "$share/.starbase"
ln -sf "$share/omarchy-pulse" "$bin"
[[ -f $cfg_dir/pulse.toml ]] || cp "$share/pulse.toml" "$cfg_dir/pulse.toml"
if grep -q '^city = ""' "$cfg_dir/pulse.toml" && [[ -t 0 ]]; then
  read -r -p "City for the weather (empty to skip): " city
  [[ -n $city ]] && sed -i "s|^city = \"\"|city = \"${city//|/}\"|" "$cfg_dir/pulse.toml"
fi
cat > "$hook" <<EOF
#!/bin/bash
exec "$share/pulse-live" "\$@"
EOF
chmod +x "$hook"
cat > "$unit" <<EOF
[Unit]
Description=Omarchy Pulse live wallpaper (Starbase edition)
PartOf=graphical-session.target
After=graphical-session.target
StartLimitIntervalSec=0

[Service]
ExecStart=$share/pulse-live --run
Restart=always
RestartSec=3
RestartPreventExitStatus=77
SuccessExitStatus=77
Environment=PYTHONUNBUFFERED=1
EOF
cat > "$desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Omarchy Pulse
Comment=The live wallpaper of the Starship and pulse themes (./install.sh --remove to undo)
Exec=$share/pulse-live --login
Terminal=false
NoDisplay=true
X-GNOME-Autostart-enabled=true
EOF
systemctl --user daemon-reload
"$share/pulse-live"

theme="$(cat "$HOME/.local/state/omarchy/current/theme.name" 2>/dev/null || true)"
echo
if [[ -f $conf ]] && grep -q ALWAYS=1 "$conf"; then
  echo "Done. The wallpaper is live with every theme (Starbase with Starship)."
elif [[ $theme == starship ]]; then
  echo "Done. Starbase is live: switch to an empty workspace to see it."
else
  echo "Done. It goes live with the Starship theme:  omarchy theme set starship"
fi
echo "  your sources:   $cfg_dir/pulse.toml   (saved = on the wallpaper in a few seconds)"
echo "  a 2-min tour:   open \"http://127.0.0.1:47800/?token=\$(cat $cfg_dir/token)&tour=1\" in a browser"
echo "  logs:           journalctl --user -u omarchy-pulse -f"
echo "  undo:           ./install.sh --remove"
