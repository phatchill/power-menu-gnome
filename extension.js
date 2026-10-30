import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

const BUTTON_WIDTH = 120;   // "row" and "split" layouts
const BUTTON_WIDTH_SMALL = 108; // used when more than 5 buttons are shown
const GRID_WIDTH = 140;     // "grid" layout
const LIST_WIDTH = 320;     // "list" layout

// Horizontal gap kept on each side of the hold bar so it stays inside the button's
// rounded corners. Must match the margins in stylesheet.css.
const BAR_INSET_CARD = 16;
const BAR_INSET_LIST = 18;

const DEFAULT_ACCENT = '#e95420'; // Ubuntu orange

// Ubuntu 24.04 (Yaru) encodes the accent in the theme name, e.g. "Yaru-prussiangreen-dark".
const YARU_ACCENTS = {
    bark: '#787859',
    sage: '#657b69',
    olive: '#4b8501',
    viridian: '#03875b',
    prussiangreen: '#308280',
    blue: '#0073e5',
    purple: '#7764d8',
    magenta: '#b34cb3',
    red: '#da3450',
};

// GNOME 47+ "accent-color" setting names, as a fallback.
const GNOME_ACCENTS = {
    blue: '#3584e4',
    teal: '#2190a4',
    green: '#3a944a',
    yellow: '#c88800',
    orange: '#ed5b00',
    red: '#e62d42',
    pink: '#d56199',
    purple: '#9141ac',
    slate: '#6f8396',
};

function getAccentColor() {
    try {
        const settings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});

        const theme = settings.get_string('gtk-theme');
        if (theme.startsWith('Yaru')) {
            const name = theme.toLowerCase().replace(/^yaru-?/, '').replace(/-?dark$/, '');
            return YARU_ACCENTS[name] ?? DEFAULT_ACCENT;
        }

        if (settings.settings_schema.has_key('accent-color'))
            return GNOME_ACCENTS[settings.get_string('accent-color')] ?? DEFAULT_ACCENT;
    } catch (e) {
        console.error(`power-menu: could not read accent color: ${e}`);
    }
    return DEFAULT_ACCENT;
}

function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [233, 84, 32];
}

// Ask systemd-logind whether hibernation is available on this machine.
function canHibernate() {
    try {
        const reply = Gio.DBus.system.call_sync(
            'org.freedesktop.login1',
            '/org/freedesktop/login1',
            'org.freedesktop.login1.Manager',
            'CanHibernate',
            null,
            new GLib.VariantType('(s)'),
            Gio.DBusCallFlags.NONE,
            1000,
            null);
        const [answer] = reply.deepUnpack();
        return answer === 'yes' || answer === 'challenge';
    } catch (e) {
        console.error(`power-menu: could not check hibernate support: ${e}`);
        return false;
    }
}

async function switchUser() {
    try {
        const {default: Gdm} = await import('gi://Gdm');
        Main.screenShield.lock(false);
        Gdm.goto_login_session_sync(null);
    } catch (e) {
        console.error(`power-menu: switch user failed: ${e}`);
        // Fall back to the lock screen so the user can still switch from there.
        Main.screenShield.lock(true);
    }
}

// Every action the menu can show. Keep `id` in sync with prefs.js and the gschema.
const ACTIONS = [
    {id: 'lock', label: 'Lock', icon: 'system-lock-screen-symbolic', defaultKey: 'L',
        run: () => Main.screenShield.lock(true)},
    {id: 'switch', label: 'Switch User', icon: 'system-users-symbolic', defaultKey: 'U',
        run: () => switchUser()},
    {id: 'logout', label: 'Log Out', icon: 'system-log-out-symbolic', defaultKey: 'O',
        run: () => GLib.spawn_command_line_async('gnome-session-quit --logout --no-prompt')},
    {id: 'sleep', label: 'Sleep', icon: 'weather-clear-night-symbolic', defaultKey: 'S',
        run: () => GLib.spawn_command_line_async('systemctl suspend')},
    {id: 'hibernate', label: 'Hibernate', icon: 'drive-harddisk-symbolic', defaultKey: 'H',
        run: () => GLib.spawn_command_line_async('systemctl hibernate')},
    {id: 'restart', label: 'Restart', icon: 'system-reboot-symbolic', defaultKey: 'R', danger: true,
        run: () => GLib.spawn_command_line_async('systemctl reboot')},
    {id: 'poweroff', label: 'Power Off', icon: 'system-shutdown-symbolic', defaultKey: 'P', danger: true,
        run: () => GLib.spawn_command_line_async('systemctl poweroff')},
];

const KEY_PATTERN = /^[A-Z0-9]$/;

function makeItem(def, key) {
    return {...def, key, button: null, bar: null, barWidth: 0};
}

const PowerDialog = GObject.registerClass(
class PowerDialog extends ModalDialog.ModalDialog {
    _init(settings) {
        super._init({styleClass: 'power-menu-dialog', destroyOnClose: false});

        this._settings = settings;
        this._items = [];
        this._layout = 'row';
        this._cols = 3;
        this._holdItem = null;
        this._holdTimeoutId = 0;
        this._pressedItem = null;
        this._countdownItem = null;
        this._countdownLeft = 0;
        this._countdownId = 0;
        this._backdrop = null;

        // Buttons are (re)built on every open so settings changes apply immediately.
        this._layoutBox = new St.BoxLayout({vertical: true});
        this.contentLayout.add_child(this._layoutBox);

        this._hint = new St.Label({
            style_class: 'power-menu-hint',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this.contentLayout.add_child(this._hint);
        this._updateHint();

        this.connect('key-press-event', (_actor, event) => this._onKeyPress(event));
        this.connect('key-release-event', (_actor, event) => this._onKeyRelease(event));
        this.connect('closed', () => {
            this._cancelHold();
            this._removeBackdrop();
        });
    }

    // Work out which buttons to show, with their configured keys.
    _collectItems() {
        const items = [];
        const hibernateOk = this._settings.get_boolean('show-hibernate') ? canHibernate() : false;

        for (const def of ACTIONS) {
            if (!this._settings.get_boolean(`show-${def.id}`))
                continue;
            if (def.id === 'hibernate' && !hibernateOk)
                continue;

            let key = this._settings.get_string(`key-${def.id}`).toUpperCase();
            if (!KEY_PATTERN.test(key))
                key = def.defaultKey;
            items.push(makeItem(def, key));
        }

        // Never show an empty menu: fall back to the core actions.
        if (items.length === 0) {
            for (const def of ACTIONS) {
                if (def.id !== 'hibernate')
                    items.push(makeItem(def, def.defaultKey));
            }
        }
        return items;
    }

    _buildCard(item, width) {
        const button = new St.Button({
            style_class: item.danger
                ? 'power-menu-button power-menu-danger'
                : 'power-menu-button',
            can_focus: true,
            width,
        });

        const box = new St.BoxLayout({vertical: true, x_align: Clutter.ActorAlign.CENTER});
        box.add_child(new St.Icon({icon_name: item.icon, style_class: 'power-menu-icon'}));
        box.add_child(new St.Label({text: item.label, style_class: 'power-menu-label'}));
        box.add_child(new St.Label({
            text: item.key,
            style_class: 'power-menu-key',
            x_align: Clutter.ActorAlign.CENTER,
        }));

        // Progress bar that fills while the key is held.
        const bar = new St.Widget({
            style_class: 'power-menu-progress',
            width: 0,
            height: 4,
            x_expand: false,
            x_align: Clutter.ActorAlign.START,
        });
        const stack = new St.BoxLayout({vertical: true});
        stack.add_child(box);
        stack.add_child(bar);
        button.set_child(stack);

        button.connect('clicked', () => this._activate(item));

        item.button = button;
        item.bar = bar;
        item.barWidth = width - 4 - 2 * BAR_INSET_CARD; // minus 2px borders and side insets
        return button;
    }

    _buildListRow(item) {
        const button = new St.Button({
            style_class: item.danger
                ? 'power-menu-button power-menu-list-button power-menu-danger'
                : 'power-menu-button power-menu-list-button',
            can_focus: true,
            width: LIST_WIDTH,
        });

        const content = new St.BoxLayout({style_class: 'power-menu-list-content'});
        content.add_child(new St.Icon({
            icon_name: item.icon,
            style_class: 'power-menu-list-icon',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        content.add_child(new St.Label({
            text: item.label,
            style_class: 'power-menu-list-label',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        content.add_child(new St.Label({
            text: item.key,
            style_class: 'power-menu-key power-menu-list-key',
            y_align: Clutter.ActorAlign.CENTER,
        }));

        const bar = new St.Widget({
            style_class: 'power-menu-progress power-menu-progress-list',
            width: 0,
            height: 4,
            x_expand: false,
            x_align: Clutter.ActorAlign.START,
        });
        const stack = new St.BoxLayout({vertical: true});
        stack.add_child(content);
        stack.add_child(bar);
        button.set_child(stack);

        button.connect('clicked', () => this._activate(item));

        item.button = button;
        item.bar = bar;
        item.barWidth = LIST_WIDTH - 4 - 2 * BAR_INSET_LIST;
        return button;
    }

    _rebuild() {
        this._items = [];
        this._pressedItem = null;
        this._layoutBox.destroy_all_children();
        this._items = this._collectItems();
        const items = this._items;

        const layout = this._settings.get_string('layout');
        this._layout = layout;
        const cardWidth = items.length > 5 ? BUTTON_WIDTH_SMALL : BUTTON_WIDTH;

        const cards = (group, width) => {
            const row = new St.BoxLayout({
                style_class: 'power-menu-row',
                x_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });
            for (const item of group)
                row.add_child(this._buildCard(item, width));
            return row;
        };

        switch (layout) {
        case 'list': {
            const list = new St.BoxLayout({vertical: true, style_class: 'power-menu-list'});
            for (const item of items)
                list.add_child(this._buildListRow(item));
            this._layoutBox.add_child(list);
            break;
        }
        case 'grid': {
            this._cols = items.length > 6 ? 4 : 3;
            const grid = new St.BoxLayout({vertical: true, style_class: 'power-menu-grid'});
            for (let i = 0; i < items.length; i += this._cols)
                grid.add_child(cards(items.slice(i, i + this._cols), GRID_WIDTH));
            this._layoutBox.add_child(grid);
            break;
        }
        case 'split': {
            const safe = items.filter(i => !i.danger);
            const danger = items.filter(i => i.danger);
            const split = new St.BoxLayout({
                style_class: 'power-menu-split',
                x_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });
            if (safe.length)
                split.add_child(cards(safe, cardWidth));
            if (safe.length && danger.length)
                split.add_child(new St.Widget({style_class: 'power-menu-divider', width: 1}));
            if (danger.length)
                split.add_child(cards(danger, cardWidth));
            this._layoutBox.add_child(split);
            break;
        }
        case 'row':
        default:
            this._layoutBox.add_child(cards(items, cardWidth));
            break;
        }
    }

    _itemForEvent(event) {
        const sym = event.get_key_symbol();
        return this._items.find(i =>
            sym === Clutter[`KEY_${i.key.toLowerCase()}`] ||
            sym === Clutter[`KEY_${i.key.toUpperCase()}`]) ?? null;
    }

    _onKeyPress(event) {
        const sym = event.get_key_symbol();
        if (sym === Clutter.KEY_Escape) {
            // While a countdown runs, Esc only cancels it; a second Esc closes the menu.
            if (this._countdownItem)
                this._cancelHold();
            else
                this.close();
            return Clutter.EVENT_STOP;
        }

        if (this._moveFocus(sym))
            return Clutter.EVENT_STOP;

        const item = this._itemForEvent(event);
        if (!item)
            return Clutter.EVENT_PROPAGATE;

        // Ignore key auto-repeat while the key is still down.
        if (this._holdItem === item || this._pressedItem === item)
            return Clutter.EVENT_STOP;
        this._pressedItem = item;

        if (this._confirmMode() === 'countdown') {
            // Pressing the same key again cancels; another key switches the countdown.
            const alreadyRunning = this._countdownItem === item;
            this._cancelHold();
            if (!alreadyRunning) {
                item.button.grab_key_focus();
                this._startCountdown(item);
            }
            return Clutter.EVENT_STOP;
        }

        this._cancelHold();
        item.button.grab_key_focus();

        const holdMs = this._holdMs();
        if (holdMs <= 0) {
            this._fire(item);
            return Clutter.EVENT_STOP;
        }

        this._holdItem = item;
        item.bar.remove_all_transitions();
        item.bar.width = 0;
        item.bar.ease({
            width: item.barWidth,
            duration: holdMs,
            mode: Clutter.AnimationMode.LINEAR,
        });
        this._holdTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, holdMs, () => {
            this._holdTimeoutId = 0;
            this._holdItem = null;
            this._fire(item);
            return GLib.SOURCE_REMOVE;
        });
        return Clutter.EVENT_STOP;
    }

    // Arrow-key navigation. Returns true if the key was an arrow key.
    _moveFocus(sym) {
        const forward = [Clutter.KEY_Right, Clutter.KEY_KP_Right, Clutter.KEY_Down, Clutter.KEY_KP_Down];
        const backward = [Clutter.KEY_Left, Clutter.KEY_KP_Left, Clutter.KEY_Up, Clutter.KEY_KP_Up];
        const vertical = [Clutter.KEY_Down, Clutter.KEY_KP_Down, Clutter.KEY_Up, Clutter.KEY_KP_Up];

        const isForward = forward.includes(sym);
        const isBackward = backward.includes(sym);
        if (!isForward && !isBackward)
            return false;

        this._cancelHold();

        const items = this._items;
        const count = items.length;
        if (count === 0)
            return true;

        const current = items.findIndex(i => i.button && global.stage.key_focus === i.button);

        let next;
        if (current < 0) {
            // Nothing focused yet: start at the first (forward) or last (backward) button.
            next = isForward ? 0 : count - 1;
        } else if (this._layout === 'grid' && vertical.includes(sym)) {
            // Up/Down move between grid rows, staying in the same column when possible.
            const cols = this._cols;
            if (isForward) {
                next = current + cols < count ? current + cols : current % cols;
            } else if (current - cols >= 0) {
                next = current - cols;
            } else {
                next = current;
                while (next + cols < count)
                    next += cols;
            }
        } else {
            next = (current + (isForward ? 1 : -1) + count) % count;
        }

        items[next].button?.grab_key_focus();
        return true;
    }

    _onKeyRelease(event) {
        const item = this._itemForEvent(event);
        if (item && item === this._pressedItem)
            this._pressedItem = null;
        if (item && item === this._holdItem)
            this._cancelHold();
        return Clutter.EVENT_PROPAGATE;
    }

    // Mouse click or Enter on a button. In countdown mode the first activation starts
    // the countdown and activating the running one again runs it right away.
    _activate(item) {
        if (this._confirmMode() === 'countdown' && this._countdownItem !== item) {
            this._cancelHold();
            this._startCountdown(item);
            return;
        }
        this._fire(item);
    }

    _startCountdown(item) {
        const secs = Math.max(1, this._settings.get_uint('countdown-secs'));
        this._countdownItem = item;
        this._countdownLeft = secs;

        item.bar.remove_all_transitions();
        item.bar.width = 0;
        item.bar.ease({
            width: item.barWidth,
            duration: secs * 1000,
            mode: Clutter.AnimationMode.LINEAR,
        });
        this._showCountdown();

        this._countdownId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            this._countdownLeft--;
            if (this._countdownLeft <= 0) {
                this._countdownId = 0;
                const target = this._countdownItem;
                this._countdownItem = null;
                if (target)
                    this._fire(target);
                return GLib.SOURCE_REMOVE;
            }
            this._showCountdown();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _showCountdown() {
        if (!this._countdownItem)
            return;
        this._hint.text =
            `${this._countdownItem.label} in ${this._countdownLeft}s  ·  Enter to run now  ·  Esc to cancel`;
    }

    _cancelHold() {
        const hadCountdown = this._countdownItem !== null;
        if (this._countdownId) {
            GLib.source_remove(this._countdownId);
            this._countdownId = 0;
        }
        this._countdownItem = null;
        if (hadCountdown)
            this._updateHint();

        if (this._holdTimeoutId) {
            GLib.source_remove(this._holdTimeoutId);
            this._holdTimeoutId = 0;
        }
        for (const item of this._items) {
            if (!item.bar)
                continue;
            item.bar.remove_all_transitions();
            item.bar.width = 0;
        }
        this._holdItem = null;
    }

    _fire(item) {
        this._cancelHold();
        this.close();
        // Let the dialog release its grab before running the action.
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            item.run();
            return GLib.SOURCE_REMOVE;
        });
    }

    _holdMs() {
        return this._settings.get_uint('hold-ms');
    }

    _confirmMode() {
        return this._settings.get_string('confirm-mode');
    }

    _updateHint() {
        if (this._confirmMode() === 'countdown') {
            const secs = this._settings.get_uint('countdown-secs');
            this._hint.text =
                `Press a key to start a ${secs}-second countdown  ·  Arrows + Enter  ·  Esc to cancel`;
        } else {
            this._hint.text = this._holdMs() > 0
                ? 'Hold a key to confirm  ·  Arrows + Enter  ·  Esc to cancel'
                : 'Press a key  ·  Arrows + Enter  ·  Esc to cancel';
        }
    }

    // Dim / blur / tint everything behind the menu, according to the settings.
    _showBackdrop() {
        this._removeBackdrop();

        const mode = this._settings.get_string('backdrop');
        if (mode === 'none')
            return;
        const strength = this._settings.get_uint('backdrop-strength') / 100;

        const backdrop = new St.Widget({reactive: false, opacity: 0});
        backdrop.set_position(0, 0);
        backdrop.set_size(global.stage.width, global.stage.height);

        const dimStyle = `background-color: rgba(0, 0, 0, ${(0.75 * strength).toFixed(2)});`;
        let style = dimStyle;

        if (mode === 'blur' || mode === 'blur-dim') {
            try {
                backdrop.add_effect(new Shell.BlurEffect({
                    sigma: Math.round(4 + 36 * strength),
                    brightness: mode === 'blur-dim' ? 1 - 0.5 * strength : 1,
                    mode: Shell.BlurMode.BACKGROUND,
                }));
                // Needs something painted for the blur to apply to.
                style = 'background-color: rgba(0, 0, 0, 0.02);';
            } catch (e) {
                console.error(`power-menu: blur unavailable, using dim instead: ${e}`);
                style = dimStyle;
            }
        } else if (mode === 'accent') {
            const [r, g, b] = hexToRgb(getAccentColor());
            style = 'background-gradient-direction: vertical; ' +
                `background-gradient-start: rgba(${r}, ${g}, ${b}, ${(0.55 * strength).toFixed(2)}); ` +
                `background-gradient-end: rgba(0, 0, 0, ${(0.7 * strength).toFixed(2)});`;
        }
        backdrop.set_style(style);

        // Bottom of the modal group, so it sits behind the menu but above windows.
        Main.layoutManager.modalDialogGroup.insert_child_below(backdrop, null);
        backdrop.ease({
            opacity: 255,
            duration: 150,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        this._backdrop = backdrop;
    }

    _removeBackdrop() {
        if (!this._backdrop)
            return;
        this._backdrop.remove_all_transitions();
        this._backdrop.destroy();
        this._backdrop = null;
    }

    _applyAccent() {
        const color = getAccentColor();
        for (const item of this._items)
            item.bar?.set_style(`background-color: ${color};`);
    }

    toggle() {
        if (this.state === ModalDialog.State.OPENED ||
            this.state === ModalDialog.State.OPENING) {
            this.close();
        } else {
            this._rebuild();
            this._applyAccent();
            this._updateHint();
            this._showBackdrop();
            if (!this.open())
                this._removeBackdrop();
        }
    }
});

export default class PowerMenuExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._dialog = new PowerDialog(this._settings);

        Main.wm.addKeybinding(
            'toggle-menu',
            this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this._dialog.toggle());
    }

    disable() {
        Main.wm.removeKeybinding('toggle-menu');
        this._dialog?._cancelHold();
        this._dialog?._removeBackdrop();
        this._dialog?.destroy();
        this._dialog = null;
        this._settings = null;
    }
}
