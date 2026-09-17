// Usage-threshold notifications with persisted per-window suppression state.
// Runs only inside GNOME Shell (imports Main), so it must not be imported by prefs.js.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const THRESHOLDS = [
    {key: '80', setting: 'notify-at-80', threshold: 80},
    {key: '90', setting: 'notify-at-90', threshold: 90},
    {key: '100', setting: 'notify-at-100', threshold: 100},
];

function parseState(raw) {
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

export class NotificationManager {
    constructor({settings}) {
        this._settings = settings;
    }

    // Evaluates a freshly fetched snapshot and fires one notification per
    // window per threshold until that window's reset time changes.
    process(snapshot) {
        if (!snapshot || snapshot.isEmpty)
            return;

        const state = parseState(this._settings.get_string('notify-state'));
        let changed = false;

        for (const window of snapshot.windows) {
            const entry = state[window.id] ?? {};
            const resetKey = window.resetsAt ? String(window.resetsAt.getTime()) : 'none';

            if (entry.resetKey !== resetKey) {
                entry.resetKey = resetKey;
                entry['80'] = false;
                entry['90'] = false;
                entry['100'] = false;
                changed = true;
            }

            for (const threshold of THRESHOLDS) {
                const enabled = this._settings.get_boolean(threshold.setting);
                const fired = entry[threshold.key] === true;
                if (enabled && !fired && window.percent >= threshold.threshold) {
                    entry[threshold.key] = true;
                    changed = true;
                    this._notify(window, threshold);
                }
            }

            state[window.id] = entry;
        }

        if (changed)
            this._settings.set_string('notify-state', JSON.stringify(state));
    }

    _notify(window, threshold) {
        const percent = Math.round(window.percent);
        let body;
        if (threshold.key === '100')
            body = `${window.name}: quota exhausted (${percent}%).`;
        else
            body = `${window.name}: ${percent}% of your quota is used.`;
        Main.notify('OpenCode Go', body);
    }
}