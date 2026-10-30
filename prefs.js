import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const SHORTCUT_KEY = 'toggle-menu';
const HOLD_KEY = 'hold-ms';
const LAYOUT_KEY = 'layout';
const BACKDROP_KEY = 'backdrop';
const STRENGTH_KEY = 'backdrop-strength';
const MODE_KEY = 'confirm-mode';
const COUNTDOWN_KEY = 'countdown-secs';

const BACKDROPS = [
    ['none', 'None'],
    ['dim', 'Dim'],
    ['blur', 'Blur'],
    ['blur-dim', 'Blur and dim'],
    ['accent', 'Accent tint'],
];

const MODES = [
    ['hold', 'Hold the key'],
    ['countdown', 'Press once, then countdown'],
];

const LAYOUTS = [
    ['row', 'Row — cards side by side'],
    ['list', 'List — one action per line'],
    ['grid', 'Grid — cards in rows of three or four'],
    ['split', 'Split — power actions kept apart'],
];

// [id, label, default key, optional note]. Keep in sync with extension.js and the gschema.
const ACTIONS = [
    ['lock', 'Lock', 'L'],
    ['switch', 'Switch User', 'U'],
    ['logout', 'Log Out', 'O'],
    ['sleep', 'Sleep', 'S'],
    ['hibernate', 'Hibernate', 'H', 'Only appears when your system supports hibernation'],
    ['restart', 'Restart', 'R'],
    ['poweroff', 'Power Off', 'P'],
];

const KEY_PATTERN = /^[A-Z0-9]$/;

export default class PowerMenuPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(560, 460);

        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        // ---- Shortcut -------------------------------------------------
        const shortcutGroup = new Adw.PreferencesGroup({
            title: 'Shortcut',
            description: 'Keyboard shortcut that opens the power menu.',
        });
        page.add(shortcutGroup);

        const shortcutRow = new Adw.ActionRow({
            title: 'Open power menu',
            subtitle: 'Click "Set" then press the new combination',
        });
        shortcutGroup.add(shortcutRow);

        const shortcutLabel = new Gtk.ShortcutLabel({
            accelerator: '',
            disabled_text: 'Disabled',
            valign: Gtk.Align.CENTER,
        });
        const setButton = new Gtk.Button({label: 'Set', valign: Gtk.Align.CENTER});
        const resetButton = new Gtk.Button({
            icon_name: 'edit-undo-symbolic',
            tooltip_text: 'Reset to default (Super+X)',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        shortcutRow.add_suffix(shortcutLabel);
        shortcutRow.add_suffix(setButton);
        shortcutRow.add_suffix(resetButton);

        const updateShortcut = () => {
            const [accel] = settings.get_strv(SHORTCUT_KEY);
            shortcutLabel.accelerator = accel ?? '';
        };
        updateShortcut();
        const shortcutChangedId = settings.connect(`changed::${SHORTCUT_KEY}`, updateShortcut);

        resetButton.connect('clicked', () => settings.reset(SHORTCUT_KEY));
        setButton.connect('clicked', () => this._captureShortcut(window, settings));

        // ---- Appearance -----------------------------------------------
        const appearanceGroup = new Adw.PreferencesGroup({
            title: 'Appearance',
        });
        page.add(appearanceGroup);

        const layoutRow = new Adw.ComboRow({
            title: 'Layout',
            subtitle: 'How the menu buttons are arranged. Applies the next time the menu opens.',
            model: Gtk.StringList.new(LAYOUTS.map(l => l[1])),
        });
        const currentLayout = settings.get_string(LAYOUT_KEY);
        layoutRow.selected = Math.max(0, LAYOUTS.findIndex(l => l[0] === currentLayout));
        layoutRow.connect('notify::selected', () => {
            const choice = LAYOUTS[layoutRow.selected];
            if (choice)
                settings.set_string(LAYOUT_KEY, choice[0]);
        });
        appearanceGroup.add(layoutRow);

        const backdropRow = new Adw.ComboRow({
            title: 'Background',
            subtitle: 'Effect behind the menu. Blur needs a GPU that supports it; otherwise it falls back to dim.',
            model: Gtk.StringList.new(BACKDROPS.map(b => b[1])),
        });
        const currentBackdrop = settings.get_string(BACKDROP_KEY);
        backdropRow.selected = Math.max(0, BACKDROPS.findIndex(b => b[0] === currentBackdrop));
        appearanceGroup.add(backdropRow);

        const strengthRow = new Adw.SpinRow({
            title: 'Background strength (%)',
            subtitle: 'How strong the dim, blur or tint is',
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 100,
                step_increment: 5,
                page_increment: 20,
                value: settings.get_uint(STRENGTH_KEY),
            }),
            sensitive: currentBackdrop !== 'none',
        });
        appearanceGroup.add(strengthRow);

        backdropRow.connect('notify::selected', () => {
            const choice = BACKDROPS[backdropRow.selected];
            if (!choice)
                return;
            settings.set_string(BACKDROP_KEY, choice[0]);
            strengthRow.sensitive = choice[0] !== 'none';
        });
        strengthRow.connect('notify::value', () => {
            settings.set_uint(STRENGTH_KEY, Math.round(strengthRow.value));
        });

        // ---- Confirmation ---------------------------------------------
        const behaviorGroup = new Adw.PreferencesGroup({
            title: 'Confirmation',
            description: 'Make a stray key press harmless: hold the key, or start a countdown you can cancel.',
        });
        page.add(behaviorGroup);

        const modeRow = new Adw.ComboRow({
            title: 'Confirm actions by',
            subtitle: 'Countdown: press a key once, then wait or press Esc to cancel',
            model: Gtk.StringList.new(MODES.map(m => m[1])),
        });
        const currentMode = settings.get_string(MODE_KEY);
        modeRow.selected = Math.max(0, MODES.findIndex(m => m[0] === currentMode));
        behaviorGroup.add(modeRow);

        const countdownRow = new Adw.SpinRow({
            title: 'Countdown (seconds)',
            subtitle: 'How long you have to cancel before the action runs',
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 30,
                step_increment: 1,
                page_increment: 5,
                value: settings.get_uint(COUNTDOWN_KEY),
            }),
            visible: currentMode === 'countdown',
        });
        behaviorGroup.add(countdownRow);
        countdownRow.connect('notify::value', () => {
            settings.set_uint(COUNTDOWN_KEY, Math.round(countdownRow.value));
        });

        const holdRow = new Adw.SpinRow({
            title: 'Hold time (milliseconds)',
            subtitle: 'How long to hold a key. Set to 0 to run the action instantly.',
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 5000,
                step_increment: 100,
                page_increment: 500,
                value: settings.get_uint(HOLD_KEY),
            }),
            visible: currentMode !== 'countdown',
        });
        behaviorGroup.add(holdRow);

        modeRow.connect('notify::selected', () => {
            const choice = MODES[modeRow.selected];
            if (!choice)
                return;
            settings.set_string(MODE_KEY, choice[0]);
            countdownRow.visible = choice[0] === 'countdown';
            holdRow.visible = choice[0] !== 'countdown';
        });

        let updating = false;
        holdRow.connect('notify::value', () => {
            if (updating)
                return;
            settings.set_uint(HOLD_KEY, Math.round(holdRow.value));
        });
        const holdChangedId = settings.connect(`changed::${HOLD_KEY}`, () => {
            updating = true;
            holdRow.value = settings.get_uint(HOLD_KEY);
            updating = false;
        });

        // ---- Buttons --------------------------------------------------
        const buttonsGroup = new Adw.PreferencesGroup({
            title: 'Buttons',
            description: 'Choose which buttons appear and which key triggers each one (a letter or digit).',
        });
        page.add(buttonsGroup);

        const resetAllButton = new Gtk.Button({
            label: 'Reset',
            valign: Gtk.Align.CENTER,
            tooltip_text: 'Restore default buttons and keys',
            css_classes: ['flat'],
        });
        buttonsGroup.set_header_suffix(resetAllButton);

        const widgets = new Map(); // id -> {entry, toggle, refresh}
        const shownCount = () =>
            ACTIONS.filter(([id]) => settings.get_boolean(`show-${id}`)).length;
        const keyClash = (id, key) => ACTIONS.some(([otherId]) =>
            otherId !== id &&
            settings.get_boolean(`show-${otherId}`) &&
            settings.get_string(`key-${otherId}`).toUpperCase() === key);

        for (const [id, label, , note] of ACTIONS) {
            const row = new Adw.ActionRow({title: label, subtitle: note ?? ''});

            const entry = new Gtk.Entry({
                max_length: 1,
                width_chars: 2,
                max_width_chars: 2,
                xalign: 0.5,
                valign: Gtk.Align.CENTER,
                text: settings.get_string(`key-${id}`).toUpperCase(),
            });
            const toggle = new Gtk.Switch({
                valign: Gtk.Align.CENTER,
                active: settings.get_boolean(`show-${id}`),
            });
            row.add_suffix(entry);
            row.add_suffix(toggle);
            row.activatable_widget = toggle;
            buttonsGroup.add(row);

            let busy = false;
            const markError = message => {
                entry.add_css_class('error');
                entry.tooltip_text = message;
            };
            const clearError = () => {
                entry.remove_css_class('error');
                entry.tooltip_text = '';
            };
            const refresh = () => {
                busy = true;
                entry.text = settings.get_string(`key-${id}`).toUpperCase();
                toggle.active = settings.get_boolean(`show-${id}`);
                clearError();
                busy = false;
            };
            widgets.set(id, {refresh});

            entry.connect('changed', () => {
                if (busy)
                    return;
                const typed = entry.text.toUpperCase();
                if (typed === '') {
                    clearError();
                    return;
                }
                if (!KEY_PATTERN.test(typed)) {
                    markError('Use a single letter or digit');
                    return;
                }
                if (keyClash(id, typed)) {
                    markError('Already used by another button');
                    return;
                }
                clearError();
                if (entry.text !== typed) {
                    busy = true;
                    entry.text = typed;
                    busy = false;
                }
                settings.set_string(`key-${id}`, typed);
            });

            // When leaving the field, snap back to the last valid key.
            const focus = new Gtk.EventControllerFocus();
            focus.connect('leave', () => {
                busy = true;
                entry.text = settings.get_string(`key-${id}`).toUpperCase();
                clearError();
                busy = false;
            });
            entry.add_controller(focus);

            toggle.connect('notify::active', () => {
                if (busy)
                    return;
                if (!toggle.active && shownCount() <= 1) {
                    // Keep at least one button visible.
                    busy = true;
                    toggle.active = true;
                    busy = false;
                    return;
                }
                settings.set_boolean(`show-${id}`, toggle.active);
            });
        }

        resetAllButton.connect('clicked', () => {
            for (const [id] of ACTIONS) {
                settings.reset(`show-${id}`);
                settings.reset(`key-${id}`);
                widgets.get(id).refresh();
            }
        });

        window.connect('close-request', () => {
            settings.disconnect(shortcutChangedId);
            settings.disconnect(holdChangedId);
            return false;
        });
    }

    _captureShortcut(parent, settings) {
        const dialog = new Gtk.Window({
            title: 'Set Shortcut',
            modal: true,
            transient_for: parent,
            resizable: false,
            default_width: 380,
            default_height: 160,
        });

        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 8,
            valign: Gtk.Align.CENTER,
            margin_top: 24,
            margin_bottom: 24,
            margin_start: 24,
            margin_end: 24,
        });
        box.append(new Gtk.Label({
            label: 'Press the new shortcut…',
            css_classes: ['title-3'],
        }));
        box.append(new Gtk.Label({
            label: 'Esc to cancel  ·  Backspace to disable',
            css_classes: ['dim-label'],
        }));
        dialog.set_child(box);

        const controller = new Gtk.EventControllerKey();
        controller.connect('key-pressed', (_ctrl, keyval, _keycode, state) => {
            const mask = state & Gtk.accelerator_get_default_mod_mask();

            if (!mask && keyval === Gdk.KEY_Escape) {
                dialog.close();
                return Gdk.EVENT_STOP;
            }

            if (!mask && keyval === Gdk.KEY_BackSpace) {
                settings.set_strv(SHORTCUT_KEY, []);
                dialog.close();
                return Gdk.EVENT_STOP;
            }

            const lowered = Gdk.keyval_to_lower(keyval);
            // Ignore lone modifier keys and combos GTK considers invalid.
            if (!Gtk.accelerator_valid(lowered, mask))
                return Gdk.EVENT_STOP;

            settings.set_strv(SHORTCUT_KEY, [Gtk.accelerator_name(lowered, mask)]);
            dialog.close();
            return Gdk.EVENT_STOP;
        });
        dialog.add_controller(controller);

        dialog.present();
    }
}
