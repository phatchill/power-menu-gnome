# Power Menu

A GNOME Shell extension (tested target: GNOME 46 / Ubuntu 24.04) that opens a
power menu with **Win + X**. Press a key, hold it, or use the arrow keys to
lock, switch user, log out, sleep, hibernate, restart or power off.

## Features

- Single-key shortcuts: `L` Lock, `U` Switch User, `O` Log Out, `S` Sleep,
  `H` Hibernate, `R` Restart, `P` Power Off (all remappable)
- Confirm by **holding** the key (progress bar) or by a cancelable **countdown**
- Arrow-key navigation, Enter to run, Esc to cancel
- Four layouts: row, list, grid, split
- Hold bar follows your Ubuntu accent color
- Background effect: none, dim, blur, blur + dim, accent tint
- Show or hide each button; Hibernate appears only if the system supports it
- Preferences window for the shortcut, layout, keys, hold time and countdown

## Install

```bash
git clone https://github.com/<your-user>/power-menu-gnome.git
cd power-menu-gnome
make install
```

Log out and back in (Wayland cannot reload the shell), then:

```bash
gnome-extensions enable power-menu@local
```

Or build a zip and install it:

```bash
make pack
gnome-extensions install --force power-menu@local.shell-extension.zip
```
## Screenshot
![Demo Run](./images/Screenshot.png)
## Settings

Open **Extension Manager** and click the gear next to Power Menu, or run:

```bash
gnome-extensions prefs power-menu@local
```

## Debugging

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

## Other GNOME versions

`metadata.json` lists only GNOME 46. For another version, add it to
`shell-version` and test.

## License

MIT, see [LICENSE](LICENSE).
