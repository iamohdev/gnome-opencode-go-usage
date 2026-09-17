// Normalization layer between the raw OpenCode Go API response and the UI.
// Pure (no GI imports) so it can be unit-tested outside of GNOME Shell.

import * as Errors from './errors.js';
import {clampPercent} from './utils.js';

const KNOWN_NAMES = {
    rolling: '5-hour',
    rolling5h: '5-hour',
    weekly: 'Weekly',
    monthly: 'Monthly',
    daily: 'Daily',
};

export function windowName(id) {
    if (KNOWN_NAMES[id])
        return KNOWN_NAMES[id];
    return id
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase())
        .trim();
}

// Accepts ISO strings, unix seconds, or unix milliseconds.
function parseTimestamp(value) {
    if (value == null || value === '')
        return null;
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || value <= 0)
            return null;
        if (value > 1e12)
            return new Date(value);
        if (value > 1e9)
            return new Date(value * 1000);
        return null;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed === '')
            return null;
        const numeric = Number(trimmed);
        if (Number.isFinite(numeric) && /^\d+(\.\d+)?$/.test(trimmed))
            return parseTimestamp(numeric);
        const date = new Date(trimmed);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
}

const PERCENT_KEYS = [
    'percent',
    'usagePercent',
    'usedPercent',
    'percentUsed',
    'usage_percent',
    'used_percent',
];

const REMAINING_KEYS = [
    'remainingPercent',
    'remaining',
    'remaining_percent',
    'leftPercent',
];

const USED_KEYS = ['used', 'amount', 'consumed', 'value', 'usedTokens'];
const LIMIT_KEYS = ['limit', 'total', 'quota', 'max', 'cap', 'tokenLimit'];

function firstNumber(object, keys) {
    for (const key of keys) {
        const value = object[key];
        if (typeof value === 'number' && Number.isFinite(value))
            return value;
        if (typeof value === 'string' && value.trim() !== '') {
            const parsed = Number(value);
            if (Number.isFinite(parsed))
                return parsed;
        }
    }
    return null;
}

// Returns a usage percentage in 0..100, or null if none can be derived.
function extractPercent(window) {
    const direct = firstNumber(window, PERCENT_KEYS);
    if (direct != null)
        return clampPercent(direct);

    const remaining = firstNumber(window, REMAINING_KEYS);
    if (remaining != null)
        return clampPercent(100 - remaining);

    const used = firstNumber(window, USED_KEYS);
    const limit = firstNumber(window, LIMIT_KEYS);
    if (used != null && limit != null && limit > 0)
        return clampPercent((used / limit) * 100);

    return null;
}

function parseWindow(id, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const percent = extractPercent(value);
    if (percent == null)
        return null;
    const resetsAt = parseTimestamp(
        value.resetsAt ?? value.resetAt ?? value.reset ?? value.nextReset ?? value.renewAt);
    return {
        id,
        name: windowName(id),
        percent,
        resetsAt,
        status: typeof value.status === 'string' ? value.status : 'ok',
    };
}

export class UsageSnapshot {
    constructor({windows = [], fetchedAt}) {
        this.windows = windows;
        this.fetchedAt = fetchedAt;
    }

    get isEmpty() {
        return this.windows.length === 0;
    }

    toJSON() {
        return {
            fetchedAt: this.fetchedAt,
            windows: this.windows.map(w => ({
                id: w.id,
                name: w.name,
                percent: w.percent,
                status: w.status,
                resetsAt: w.resetsAt ? w.resetsAt.toISOString() : null,
            })),
        };
    }

    static fromJSON(json) {
        if (!json || typeof json !== 'object' || !Array.isArray(json.windows))
            return null;
        const windows = [];
        for (const w of json.windows) {
            if (!w || typeof w !== 'object' || typeof w.id !== 'string')
                return null;
            const percent = firstNumber(w, ['percent']);
            if (percent == null)
                return null;
            windows.push({
                id: w.id,
                name: typeof w.name === 'string' ? w.name : windowName(w.id),
                percent: clampPercent(percent),
                status: typeof w.status === 'string' ? w.status : 'ok',
                resetsAt: parseTimestamp(w.resetsAt),
            });
        }
        return new UsageSnapshot({
            windows,
            fetchedAt: typeof json.fetchedAt === 'number' ? json.fetchedAt : Date.now(),
        });
    }
}

// Normalizes the raw API response into a UsageSnapshot.
// Throws ParseError for malformed payloads; returns an empty snapshot for valid-but-empty usage.
export function normalizeUsageResponse(raw, {fetchedAt = Date.now()} = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw new Errors.ParseError('Response is not an object.');
    const usage = raw.usage ?? raw;
    if (!usage || typeof usage !== 'object')
        throw new Errors.ParseError('Missing usage data.');

    const windows = [];
    const addWindow = (id, value) => {
        const parsed = parseWindow(id, value);
        if (parsed)
            windows.push(parsed);
    };

    if (Array.isArray(usage)) {
        usage.forEach((value, index) => {
            const id = value?.id ?? value?.name ?? String(index);
            addWindow(id, value);
        });
    } else {
        for (const [id, value] of Object.entries(usage)) {
            if (Array.isArray(value)) {
                value.forEach((item, index) => {
                    const subId = item?.id ?? item?.name ?? `${id}-${index}`;
                    addWindow(subId, item);
                });
            } else {
                addWindow(id, value);
            }
        }
    }

    return new UsageSnapshot({windows, fetchedAt});
}