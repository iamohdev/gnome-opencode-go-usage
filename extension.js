// OpenCode Go Usage — GNOME Shell extension (GNOME 45+, ESM).

import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Atk from 'gi://Atk';
import GObject from 'gi://GObject';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Spinner} from 'resource:///org/gnome/shell/ui/animation.js';

import {OpenCodeGoApi} from './lib/api.js';
import {UsageCache} from './lib/cache.js';
import {SecretStore} from './lib/secrets.js';
import {NotificationManager} from './lib/notifications.js';
import * as Errors from './lib/errors.js';
import * as Util from './lib/utils.js';

const COUNTDOWN_INTERVAL_SECONDS = 30;
const STALE_CACHE_MS = 6 * 3600 * 1000;

// Theme-aware progress bar drawn with cairo, modeled after the shell's own
// BarLevel widget. GNOME Shell no longer ships St.ProgressBar, so we draw the
// track/fill from the theme's foreground color (adapting to light, dark, and
// high-contrast themes) and override only for warning/critical/exhausted.
const QuotaProgressBar = GObject.registerClass(
class QuotaProgressBar extends St.DrawingArea {
    _init() {
        super._init({
            style_class: 'opencode-progress',
            accessible_role: Atk.Role.LEVEL_BAR,
        });
        this._value = 0;
        this._level = 'normal';
        this._height = 6;
        this._width = 180;
        this._trackColor = [0.5, 0.5, 0.5, 0.3];
        this._activeColor = [0.5, 0.5, 0.5, 0.9];
        this._warningColor = [0.898, 0.647, 0.039, 1];
        this._criticalColor = [0.878, 0.106, 0.141, 1];
    }

    set fraction(value) {
        this._value = Math.max(0, Math.min(1, value));
        this.queue_repaint();
    }

    set level(value) {
        this._level = value;
        this.queue_repaint();
    }

    _readColor(prop, fallback) {
        try {
            const color = this.get_theme_node().get_color(prop);
            return [color.red / 255, color.green / 255, color.blue / 255, color.alpha / 255];
        } catch {
            return fallback;
        }
    }

    vfunc_style_changed() {
        const themeNode = this.get_theme_node();
        try {
            this._height = themeNode.get_length('-opencode-progress-height');
        } catch {
            this._height = 6;
        }
        try {
            this._width = themeNode.get_length('-opencode-progress-width');
        } catch {
            this._width = 180;
        }

        // Derive the track and fill from the theme foreground so the bar
        // follows light/dark/high-contrast themes automatically.
        try {
            const fg = themeNode.get_foreground_color();
            this._trackColor = [fg.red / 255, fg.green / 255, fg.blue / 255, 0.25];
            this._activeColor = [fg.red / 255, fg.green / 255, fg.blue / 255, 1];
        } catch {
            this._trackColor = [0.5, 0.5, 0.5, 0.3];
            this._activeColor = [0.5, 0.5, 0.5, 0.9];
        }

        this._warningColor = this._readColor('-opencode-progress-warning-color', this._warningColor);
        this._criticalColor = this._readColor('-opencode-progress-critical-color', this._criticalColor);

        super.vfunc_style_changed();
    }

    vfunc_get_preferred_height(forWidth) {
        const themeNode = this.get_theme_node();
        return themeNode.adjust_preferred_height(this._height, this._height);
    }

    vfunc_get_preferred_width(forHeight) {
        const themeNode = this.get_theme_node();
        return themeNode.adjust_preferred_width(this._width, this._width);
    }

    vfunc_repaint() {
        const cr = this.get_context();
        const [width, height] = this.get_surface_size();
        if (width > 0 && height > 0) {
            const TAU = Math.PI * 2;
            const radius = Math.min(this._height / 2, height / 2);

            // Pill outline: left cap bulging left, right cap bulging right.
            const pill = () => {
                cr.moveTo(radius, height);
                cr.arc(radius, height / 2, radius, TAU * 0.25, TAU * 0.75);
                cr.lineTo(width - radius, 0);
                cr.arc(width - radius, height / 2, radius, TAU * 0.75, TAU * 0.25);
                cr.closePath();
            };

            // Track.
            pill();
            cr.setSourceRGBA(...this._trackColor);
            cr.fill();

            // Fill: same pill, clipped to the filled width so the right edge
            // stays straight until the bar is full.
            const fillWidth = Math.max(0, Math.min(width, Math.round(width * this._value)));
            if (fillWidth > 0) {
                let color = this._activeColor;
                if (this._level === 'warning')
                    color = this._warningColor;
                else if (this._level === 'critical' || this._level === 'exhausted')
                    color = this._criticalColor;

                cr.save();
                cr.rectangle(0, 0, fillWidth, height);
                cr.clip();
                pill();
                cr.setSourceRGBA(...color);
                cr.fill();
                cr.restore();
            }
        }
        cr.$dispose();
    }
});

const PanelIndicator = GObject.registerClass(
class PanelIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'OpenCode Go', false);

        const box = new St.BoxLayout({style_class: 'opencode-go-panel-box'});
        this._label = new St.Label({
            text: 'Go',
            style_class: 'opencode-go-panel-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._percent = new St.Label({
            text: '…',
            style_class: 'opencode-go-panel-percent',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._label);
        box.add_child(this._percent);
        this.add_child(box);
    }

    setLabelVisible(visible) {
        this._label.visible = visible;
    }

    setPercentVisible(visible) {
        this._percent.visible = visible;
    }

    setPercent(text, level = 'normal') {
        this._percent.text = text;
        this._percent.style_class = `opencode-go-panel-percent ${level}`;
    }
});

const QuotaWindowItem = GObject.registerClass(
class QuotaWindowItem extends PopupMenu.PopupBaseMenuItem {
    _init() {
        super._init({reactive: false, can_focus: false, hover: false});

        const box = new St.BoxLayout({vertical: true, style_class: 'opencode-quota-window'});

        const header = new St.BoxLayout({style_class: 'opencode-quota-header'});
        this._name = new St.Label({
            text: '',
            style_class: 'opencode-quota-name',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
        });
        this._percent = new St.Label({
            text: '',
            style_class: 'opencode-quota-percent',
            x_align: Clutter.ActorAlign.END,
        });
        header.add_child(this._name);
        header.add_child(this._percent);

        this._progress = new QuotaProgressBar();

        this._reset = new St.Label({
            text: '',
            style_class: 'opencode-quota-reset',
        });

        box.add_child(header);
        box.add_child(this._progress);
        box.add_child(this._reset);
        this.add_child(box);
    }

    update(window, now) {
        this.window = window;
        const percent = Math.round(window.percent);
        const level = Util.levelClass(window.percent);

        this._name.text = window.name;
        this._percent.text = `${percent}%`;
        this._percent.style_class = `opencode-quota-percent ${level}`;
        this._progress.fraction = window.percent / 100;
        this._progress.level = level;

        if (window.resetsAt) {
            const remaining = window.resetsAt.getTime() - now;
            this._reset.text = remaining <= 0
                ? 'Resets now'
                : `Resets in ${Util.formatCountdown(remaining)}`;
        } else {
            this._reset.text = '';
        }

        this.accessible_name = `${window.name}: ${percent}% used. ${this._reset.text}`;
    }
});

const RefreshItem = GObject.registerClass(
class RefreshItem extends PopupMenu.PopupBaseMenuItem {
    _init(callback) {
        super._init({});
        const icon = new St.Icon({
            icon_name: 'view-refresh-symbolic',
            style_class: 'popup-menu-icon',
        });
        const label = new St.Label({text: 'Refresh', x_expand: true});
        this._spinner = new Spinner(16);
        this._spinner.visible = false;
        this.add_child(icon);
        this.add_child(label);
        this.add_child(this._spinner);
        this.connect('activate', () => callback());
    }

    setBusy(busy) {
        this.reactive = !busy;
        this.can_focus = !busy;
        if (busy) {
            this._spinner.visible = true;
            this._spinner.play();
        } else {
            this._spinner.stop();
            this._spinner.visible = false;
        }
    }
});

export default class OpenCodeGoUsageExtension extends Extension {
    enable() {
        this._enabled = true;
        this._settings = this.getSettings();
        this._settingsHandlers = [];

        this._api = new OpenCodeGoApi();
        this._cache = new UsageCache();
        this._secrets = new SecretStore({label: `${this.metadata.name} API key`});
        this._notifier = new NotificationManager({settings: this._settings});

        this._apiKey = null;
        this._apiKeyLoaded = false;
        this._snapshot = null;
        this._error = null;
        this._fetching = false;
        this._refreshTimerId = 0;
        this._countdownTimerId = 0;
        this._windowItems = [];

        this._buildIndicator();
        this._buildMenu();
        this._connectSettings();

        // Show cached data immediately, then refresh in the background.
        this._snapshot = this._cache.load();
        this._updateIndicator();
        this._renderMenu();

        this._loadApiKeyAndFetch().catch(error => {
            if (!this._enabled)
                return;
            this._error = error;
            this._updateIndicator();
            this._renderMenu();
        });

        this._scheduleRefresh();
        this._scheduleCountdown();
    }

    disable() {
        this._enabled = false;
        this._destroyTimers();
        this._api?.cancel();
        this._api = null;
        this._notifier = null;
        this._disconnectSettings();
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }

    // ------------------------------------------------------------- startup

    async _loadApiKeyAndFetch() {
        const key = await this._secrets.load();
        if (!this._enabled)
            return;
        this._apiKey = key;
        this._apiKeyLoaded = true;
        if (key) {
            await this._fetch();
        } else {
            this._error = new Errors.NoApiKeyError();
            this._updateIndicator();
            this._renderMenu();
        }
    }

    // ------------------------------------------------------------- settings

    _connectSettings() {
        const watch = (key, callback) => {
            this._settingsHandlers.push(this._settings.connect(`changed::${key}`, callback));
        };
        watch('refresh-interval', () => this._scheduleRefresh());
        watch('show-percentage', () => this._updateIndicator());
        watch('show-countdown', () => this._updateIndicator());
        watch('show-label', () => this._updateIndicator());
        watch('panel-mode', () => this._updateIndicator());
        watch('last-updated-format', () => this._renderMenu());
        watch('hidden-windows', () => {
            this._updateIndicator();
            this._renderMenu();
        });
        watch('credential-revision', () => {
            this._loadApiKeyAndFetch().catch(() => {});
        });
    }

    _disconnectSettings() {
        for (const id of this._settingsHandlers)
            this._settings.disconnect(id);
        this._settingsHandlers = [];
    }

    // ------------------------------------------------------------- timers

    _scheduleRefresh() {
        if (this._refreshTimerId) {
            GLib.source_remove(this._refreshTimerId);
            this._refreshTimerId = 0;
        }
        const seconds = this._settings.get_int('refresh-interval');
        this._refreshTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
            if (!this._enabled)
                return GLib.SOURCE_REMOVE;
            this._fetch();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _scheduleCountdown() {
        if (this._countdownTimerId) {
            GLib.source_remove(this._countdownTimerId);
            this._countdownTimerId = 0;
        }
        this._countdownTimerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, COUNTDOWN_INTERVAL_SECONDS, () => {
                if (!this._enabled)
                    return GLib.SOURCE_REMOVE;
                this._onCountdownTick();
                return GLib.SOURCE_CONTINUE;
            });
    }

    _destroyTimers() {
        for (const id of [this._refreshTimerId, this._countdownTimerId]) {
            if (id)
                GLib.source_remove(id);
        }
        this._refreshTimerId = 0;
        this._countdownTimerId = 0;
    }

    _onCountdownTick() {
        if (!this._snapshot)
            return;
        const now = Date.now();
        const anyReset = this._snapshot.windows.some(w => w.resetsAt && w.resetsAt.getTime() <= now);
        if (anyReset) {
            this._fetch();
            return;
        }
        for (const item of this._windowItems) {
            if (item.window)
                item.update(item.window, now);
        }
        this._statusItem.label.text = this._statusText();
        this._updateIndicator();
    }

    // ------------------------------------------------------------- fetching

    async _fetch() {
        if (this._fetching)
            return;
        if (!this._apiKey)
            return;
        this._fetching = true;
        this._setRefreshing(true);
        try {
            const snapshot = await this._api.getUsage(this._apiKey);
            if (!this._enabled)
                return;
            this._snapshot = snapshot;
            this._error = null;
            this._cache.save(snapshot);
            this._notifier?.process(snapshot);
            this._updateIndicator();
            this._renderMenu();
        } catch (error) {
            if (!this._enabled)
                return;
            if (error instanceof Errors.CancelledError)
                return;
            this._error = error;
            this._updateIndicator();
            this._renderMenu();
        } finally {
            this._fetching = false;
            if (this._enabled)
                this._setRefreshing(false);
        }
    }

    _setRefreshing(busy) {
        this._refreshItem?.setBusy(busy);
    }

    // ------------------------------------------------------------- panel

    _buildIndicator() {
        this._indicator = new PanelIndicator();
        Main.panel.addToStatusArea(this.uuid, this._indicator, 1, 'right');
    }

    _visibleWindows() {
        if (!this._snapshot)
            return [];
        const hidden = new Set(this._settings.get_strv('hidden-windows'));
        return this._snapshot.windows.filter(w => !hidden.has(w.id));
    }

    _displayWindow() {
        const windows = this._visibleWindows();
        if (windows.length === 0)
            return null;
        const mode = this._settings.get_string('panel-mode');
        if (mode !== 'highest') {
            const match = windows.find(w => w.id === mode);
            if (match)
                return match;
        }
        return windows.reduce((a, b) => (b.percent > a.percent ? b : a));
    }

    _updateIndicator() {
        const window = this._displayWindow();
        const showCountdown = this._settings.get_boolean('show-countdown');

        if (window) {
            const level = Util.levelClass(window.percent);
            const showPercentage = this._settings.get_boolean('show-percentage');
            let text = '';
            if (showPercentage)
                text = `${Math.round(window.percent)}%`;
            if (showCountdown && window.resetsAt) {
                const remaining = window.resetsAt.getTime() - Date.now();
                const countdown = remaining > 0
                    ? Util.formatCountdown(remaining)
                    : (showPercentage ? 'now' : '0m');
                text = text ? `${text} (${countdown})` : countdown;
            }
            this._indicator.setPercent(text || '—', level);
        } else if (this._snapshot) {
            this._indicator.setPercent('—');
        } else if (this._error instanceof Errors.NoApiKeyError ||
                   this._error instanceof Errors.AuthError) {
            this._indicator.setPercent('—');
        } else if (this._error) {
            this._indicator.setPercent('!', 'warning');
        } else {
            this._indicator.setPercent('…');
        }

        this._indicator.setLabelVisible(this._settings.get_boolean('show-label'));
        this._indicator.setPercentVisible(
            this._settings.get_boolean('show-percentage') || showCountdown);

        this._updateTooltip();
    }

    _updateTooltip() {
        const window = this._displayWindow();
        const lines = ['OpenCode Go'];
        if (window) {
            lines.push(`${window.name}: ${Math.round(window.percent)}%`);
            if (window.resetsAt) {
                const remaining = window.resetsAt.getTime() - Date.now();
                if (remaining <= 0)
                    lines.push('Resets now');
                else
                    lines.push(`Resets in ${Util.formatCountdown(remaining)}`);
            }
        } else if (this._error) {
            lines.push(this._error.message);
        }
        this._indicator.tooltip_text = lines.join('\n');
    }

    // ------------------------------------------------------------- menu

    _buildMenu() {
        const menu = this._indicator.menu;

        const headerItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const title = new St.Label({text: 'OpenCode Go', style_class: 'opencode-menu-title'});
        headerItem.add_child(title);
        menu.addMenuItem(headerItem);

        this._windowSection = new PopupMenu.PopupMenuSection();
        menu.addMenuItem(this._windowSection);

        this._statusItem = new PopupMenu.PopupMenuItem('', {reactive: false, can_focus: false});
        menu.addMenuItem(this._statusItem);

        this._errorSection = new PopupMenu.PopupMenuSection();
        menu.addMenuItem(this._errorSection);

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._refreshItem = new RefreshItem(() => this._fetch());
        menu.addMenuItem(this._refreshItem);

        const prefsAction = new PopupMenu.PopupImageMenuItem(
            'Preferences', 'preferences-system-symbolic', {});
        prefsAction.connect('activate', () => this.openPreferences());
        menu.addMenuItem(prefsAction);
    }

    _renderMenu() {
        this._windowSection.removeAll();
        this._windowItems = [];
        const now = Date.now();

        for (const window of this._visibleWindows()) {
            const item = new QuotaWindowItem();
            item.update(window, now);
            this._windowSection.addMenuItem(item);
            this._windowItems.push(item);
        }

        this._statusItem.label.text = this._statusText();
        this._renderErrorState();
    }

    _statusText() {
        if (this._snapshot) {
            const age = Date.now() - this._snapshot.fetchedAt;
            if (this._error)
                return `Offline · ${this._formatLastUpdated(age)}`;
            if (age > STALE_CACHE_MS)
                return `${this._formatLastUpdated(age)} (stale)`;
            return this._formatLastUpdated(age);
        }
        return 'No data yet';
    }

    _formatLastUpdated(age) {
        if (this._settings.get_string('last-updated-format') === 'exact')
            return `Last updated ${Util.formatClock(new Date(this._snapshot.fetchedAt))}`;
        return `Last updated ${Util.formatRelativeTime(age)}`;
    }

    _renderErrorState() {
        this._errorSection.removeAll();

        let message = null;
        let showPreferences = false;

        if (!this._apiKey && this._apiKeyLoaded) {
            message = 'API key not configured';
            showPreferences = true;
        } else if (this._error instanceof Errors.NoApiKeyError) {
            message = 'API key not configured';
            showPreferences = true;
        } else if (this._error instanceof Errors.AuthError) {
            message = 'Authentication failed';
            showPreferences = true;
        } else if (this._error instanceof Errors.EntitlementError) {
            message = this._error.message;
        } else if (this._error instanceof Errors.RateLimitedError) {
            message = 'Too many requests';
            if (this._error.retryAfterMs)
                message += ` · retry in ${Util.formatCountdown(this._error.retryAfterMs)}`;
        } else if (this._error instanceof Errors.NetworkError) {
            message = 'Unable to reach OpenCode';
        } else if (this._error instanceof Errors.ParseError) {
            message = 'Unexpected API response';
        } else if (this._error instanceof Errors.ServerError) {
            message = this._error.message;
        } else if (this._error instanceof Errors.SecretError) {
            message = 'Unable to read the API key securely';
            showPreferences = true;
        } else if (this._error) {
            message = 'Unable to fetch usage';
        }

        if (this._snapshot?.isEmpty && !message)
            message = 'No usage information available';

        if (message) {
            const item = new PopupMenu.PopupMenuItem(message, {reactive: false, can_focus: false});
            item.style_class = 'opencode-error-item';
            this._errorSection.addMenuItem(item);
        }

        if (showPreferences) {
            const button = new PopupMenu.PopupImageMenuItem(
                'Open Preferences', 'preferences-system-symbolic', {});
            button.connect('activate', () => this.openPreferences());
            this._errorSection.addMenuItem(button);
        }
    }
}