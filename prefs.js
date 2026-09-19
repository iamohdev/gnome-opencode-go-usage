// Preferences window for OpenCode Go Usage (GTK4 / Libadwaita).

import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {OpenCodeGoApi} from './lib/api.js';
import {SecretStore} from './lib/secrets.js';
import * as Errors from './lib/errors.js';

const REFRESH_OPTIONS = [
    ['15 seconds', 15],
    ['30 seconds', 30],
    ['1 minute', 60],
    ['5 minutes', 300],
    ['10 minutes', 600],
    ['30 minutes', 1800],
    ['1 hour', 3600],
];

const PANEL_MODES = [
    ['Most used window', 'highest'],
    ['5-hour window', 'rolling'],
    ['Weekly window', 'weekly'],
    ['Monthly window', 'monthly'],
];

const TIME_FORMATS = [
    ['Relative (e.g. “1m ago”)', 'relative'],
    ['Exact time (e.g. “14:32”)', 'exact'],
];

const KNOWN_WINDOWS = [
    ['5-hour window', 'rolling'],
    ['Weekly window', 'weekly'],
    ['Monthly window', 'monthly'],
];

function describeError(error) {
    if (error instanceof Errors.AuthError)
        return 'Invalid API key (authentication failed).';
    if (error instanceof Errors.EntitlementError)
        return 'This API key has no OpenCode Go subscription.';
    if (error instanceof Errors.RateLimitedError)
        return 'Too many requests. Try again later.';
    if (error instanceof Errors.ParseError)
        return 'Unexpected API response.';
    if (error instanceof Errors.NetworkError)
        return 'Network error. Check your connection.';
    return error?.message ?? 'Unknown error.';
}

export default class OpenCodeGoUsagePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this._settings = this.getSettings();
        this._secrets = new SecretStore({label: `${this.metadata.name} API key`});
        this._api = new OpenCodeGoApi();
        this._saving = false;
        this._windowClosing = false;

        window.connect('close-request', () => {
            this._windowClosing = true;
            this._api?.cancel();
            this._api = null;
            this._secrets = null;
            this._settings = null;
            this._keyRow = null;
            this._statusRow = null;
        });

        const generalPage = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'preferences-system-symbolic',
        });
        generalPage.add(this._buildAccountGroup());
        generalPage.add(this._buildRefreshGroup());
        window.add(generalPage);

        const displayPage = new Adw.PreferencesPage({
            title: 'Display',
            icon_name: 'preferences-desktop-display-symbolic',
        });
        displayPage.add(this._buildDisplayGroup());
        displayPage.add(this._buildQuotaGroup());
        window.add(displayPage);

        const notificationsPage = new Adw.PreferencesPage({
            title: 'Notifications',
            icon_name: 'preferences-system-notifications-symbolic',
        });
        notificationsPage.add(this._buildNotificationGroup());
        window.add(notificationsPage);

        window.set_default_size(520, 640);

        this._loadKeyIntoEntry();
    }

    // ------------------------------------------------------------- account

    _buildAccountGroup() {
        const group = new Adw.PreferencesGroup({
            title: 'OpenCode Go',
            description: 'The API key is stored securely in the GNOME Secret Service.',
        });

        this._keyRow = new Adw.PasswordEntryRow({
            title: 'API Key',
            show_apply_button: true,
            input_hints: Gtk.InputHints.NO_PREDICTION | Gtk.InputHints.SPELLCHECK_NO_SUGGESTION,
        });
        this._keyRow.connect('apply', () => this._saveAndTestKey());
        group.add(this._keyRow);

        this._statusRow = new Adw.ActionRow({
            title: 'Status',
            subtitle: 'Enter your API key and press Enter to save and test it.',
        });
        group.add(this._statusRow);

        const getKeyRow = new Adw.ActionRow({
            title: 'Get an API key',
            subtitle: 'opencode.ai/auth',
            activatable: true,
        });
        getKeyRow.connect('activated', () => {
            Gio.AppInfo.launch_default_for_uri('https://opencode.ai/auth', null);
        });
        group.add(getKeyRow);

        return group;
    }

    async _loadKeyIntoEntry() {
        try {
            const key = await this._secrets.load();
            if (this._windowClosing)
                return;
            if (key)
                this._keyRow.set_text(key);
        } catch (error) {
            this._setStatus('Unable to read the API key from the Secret Service.', 'error');
        }
    }

    async _saveAndTestKey() {
        if (this._saving)
            return;
        const value = this._keyRow.get_text().trim();
        if (value === '') {
            this._setStatus('Enter a key to save it.', 'error');
            return;
        }

        this._saving = true;
        this._keyRow.sensitive = false;
        this._setStatus('Testing…', 'busy');
        try {
            const settings = this._settings;
            await this._secrets.store(value);
            settings.set_int(
                'credential-revision', settings.get_int('credential-revision') + 1);
        } catch (error) {
            if (this._windowClosing)
                return;
            this._setStatus('Could not store the API key in the Secret Service.', 'error');
            this._keyRow.sensitive = true;
            this._saving = false;
            return;
        }

        if (this._windowClosing)
            return;

        try {
            const snapshot = await this._api.getUsage(value);
            if (this._windowClosing)
                return;
            const count = snapshot.windows.length;
            const detail = count === 0
                ? 'The API key is valid, but no usage data was returned.'
                : `The API key is valid (${count} quota window${count === 1 ? '' : 's'} found).`;
            this._setStatus(`✓ ${detail}`, 'success');
        } catch (error) {
            if (this._windowClosing)
                return;
            this._setStatus(`✗ API request failed: ${describeError(error)}`, 'error');
        }

        this._keyRow.sensitive = true;
        this._saving = false;
    }

    _setStatus(text, state) {
        if (this._windowClosing)
            return;
        this._statusRow.subtitle = text;
        this._statusRow.remove_css_class('opencode-success');
        this._statusRow.remove_css_class('opencode-error');
        if (state === 'success')
            this._statusRow.add_css_class('opencode-success');
        if (state === 'error')
            this._statusRow.add_css_class('opencode-error');
    }

    // ------------------------------------------------------------- refresh

    _buildRefreshGroup() {
        const group = new Adw.PreferencesGroup({
            title: 'Refresh',
            description: 'How often usage is checked. Avoid excessive requests.',
        });

        const model = new Gtk.StringList({strings: REFRESH_OPTIONS.map(([label]) => label)});
        const row = new Adw.ComboRow({title: 'Refresh interval', model});
        const current = this._settings.get_int('refresh-interval');
        const index = REFRESH_OPTIONS.findIndex(([, seconds]) => seconds === current);
        row.set_selected(index >= 0 ? index : 1);
        row.connect('notify::selected', () => {
            const [label, seconds] = REFRESH_OPTIONS[row.get_selected()] ?? REFRESH_OPTIONS[1];
            this._settings.set_int('refresh-interval', seconds);
            row.subtitle = label;
        });
        group.add(row);
        return group;
    }

    // ------------------------------------------------------------- display

    _buildDisplayGroup() {
        const group = new Adw.PreferencesGroup({
            title: 'Panel display',
            description: 'Which elements appear in the top panel.',
        });

        const percentage = new Adw.SwitchRow({
            title: 'Show percentage',
            subtitle: 'Display the usage percentage in the panel.',
        });
        this._settings.bind('show-percentage', percentage, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(percentage);

        const countdown = new Adw.SwitchRow({
            title: 'Show time until reset',
            subtitle: 'Display the time until the quota window resets in the panel.',
        });
        this._settings.bind('show-countdown', countdown, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(countdown);

        const label = new Adw.SwitchRow({
            title: 'Show “Go” label',
            subtitle: 'Display the “Go” label in the panel.',
        });
        this._settings.bind('show-label', label, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(label);

        const model = new Gtk.StringList({strings: PANEL_MODES.map(([label]) => label)});
        const mode = new Adw.ComboRow({title: 'Panel shows', model});
        const currentMode = this._settings.get_string('panel-mode');
        const modeIndex = PANEL_MODES.findIndex(([, value]) => value === currentMode);
        mode.set_selected(modeIndex >= 0 ? modeIndex : 0);
        mode.connect('notify::selected', () => {
            const [label, value] = PANEL_MODES[mode.get_selected()] ?? PANEL_MODES[0];
            this._settings.set_string('panel-mode', value);
            mode.subtitle = label;
        });
        group.add(mode);

        const formatModel = new Gtk.StringList({strings: TIME_FORMATS.map(([label]) => label)});
        const format = new Adw.ComboRow({title: 'Last updated format', model: formatModel});
        const currentFormat = this._settings.get_string('last-updated-format');
        const formatIndex = TIME_FORMATS.findIndex(([, value]) => value === currentFormat);
        format.set_selected(formatIndex >= 0 ? formatIndex : 0);
        format.connect('notify::selected', () => {
            const [label, value] = TIME_FORMATS[format.get_selected()] ?? TIME_FORMATS[0];
            this._settings.set_string('last-updated-format', value);
            format.subtitle = label;
        });
        group.add(format);

        return group;
    }

    _buildQuotaGroup() {
        const group = new Adw.PreferencesGroup({
            title: 'Quota windows',
            description: 'Choose which quota windows are shown in the panel and popup.',
        });

        for (const [label, id] of KNOWN_WINDOWS) {
            const row = new Adw.SwitchRow({
                title: label,
                subtitle: `Show the ${label.toLowerCase()} in the UI.`,
            });
            row.active = !this._settings.get_strv('hidden-windows').includes(id);
            row.connect('notify::active', () => this._setHidden(id, !row.active));
            group.add(row);
        }

        return group;
    }

    _setHidden(id, hidden) {
        const current = this._settings.get_strv('hidden-windows').filter(x => x !== id);
        if (hidden)
            current.push(id);
        this._settings.set_strv('hidden-windows', current);
    }

    // ------------------------------------------------------------- notifications

    _buildNotificationGroup() {
        const group = new Adw.PreferencesGroup({
            title: 'Threshold notifications',
            description: 'Notifications fire once per quota window until that window resets.',
        });

        const at80 = new Adw.SwitchRow({
            title: 'Notify at 80%',
            subtitle: 'Warn when a quota window reaches 80% usage.',
        });
        this._settings.bind('notify-at-80', at80, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(at80);

        const at90 = new Adw.SwitchRow({
            title: 'Notify at 90%',
            subtitle: 'Warn when a quota window reaches 90% usage.',
        });
        this._settings.bind('notify-at-90', at90, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(at90);

        const at100 = new Adw.SwitchRow({
            title: 'Notify at 100%',
            subtitle: 'Warn when a quota window is exhausted.',
        });
        this._settings.bind('notify-at-100', at100, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(at100);

        return group;
    }
}