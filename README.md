# Downloads Stack

Downloads Stack is a GNOME Shell extension that places a Downloads button in
the top panel. It shows the most recently modified files in the user's Downloads
folder and lets them be opened or dragged into other applications.

> [!IMPORTANT]
> Downloads Stack requires a GNOME X11/Xorg session. Wayland is not supported.

## Features

- Shows up to 40 recent files and folders.
- Updates automatically when the Downloads folder changes.
- Supports native file drag and drop to other X11 applications.
- Opens files with their default application.
- Hides incomplete browser downloads and hidden files.
- Runs the GTK window outside the GNOME Shell process.

## Compatibility

- GNOME Shell 46
- X11/Xorg session
- GJS, GTK 4, libadwaita and the GTK 4 X11 backend

The extension deliberately does not support Wayland. GNOME versions not listed
in `metadata.json` have not been tested and should not be enabled by bypassing
the version check.

## Install from a release

Download `downloads-stack@rauye.github.io.shell-extension.zip` from the latest
GitHub release, then run:

```sh
gnome-extensions install --force downloads-stack@rauye.github.io.shell-extension.zip
```

Restart GNOME Shell on X11 with <kbd>Alt</kbd>+<kbd>F2</kbd>, enter `r`, and
enable the extension:

```sh
gnome-extensions enable downloads-stack@rauye.github.io
```

## Install from source

```sh
git clone https://github.com/rauye/gnome-downloads-stack.git
cd gnome-downloads-stack
make install
```

Restart GNOME Shell and enable the extension as described above.

## Build

Create the same ZIP used by GitHub releases and extensions.gnome.org:

```sh
make pack
```

The package is written to `dist/`. Its root contains only the runtime files
required by the extension.

## Uninstall

```sh
make uninstall
```

Restart GNOME Shell after uninstalling.

## Troubleshooting

Confirm that the current session is X11:

```sh
printf '%s\n' "$XDG_SESSION_TYPE"
```

It should print `x11`. To follow GNOME Shell errors while testing:

```sh
journalctl -f -o cat /usr/bin/gnome-shell
```

Issues can be reported at
[github.com/rauye/gnome-downloads-stack/issues](https://github.com/rauye/gnome-downloads-stack/issues).

## License

Copyright © 2026 rauye. Licensed under the GNU General Public License v3.0 or
later. See [LICENSE](LICENSE).
