// Unit tests for the pure normalization/parsing logic.
// Run with: gjs -m tests/run.js   (or: make test)

import {
    normalizeUsageResponse,
    UsageSnapshot,
    windowName,
} from '../lib/usage.js';
import {classifyHttpStatus, parseRetryAfter} from '../lib/http.js';
import * as Errors from '../lib/errors.js';
import {formatCountdown, formatRelativeTime} from '../lib/utils.js';

let passed = 0;
let failed = 0;

function ok(condition, message) {
    if (condition) {
        passed++;
    } else {
        failed++;
        console.error(`FAIL: ${message}`);
    }
}

function eq(actual, expected, message) {
    const okValue = Object.is(actual, expected);
    if (okValue) {
        passed++;
    } else {
        failed++;
        console.error(`FAIL: ${message} (expected ${expected}, got ${actual})`);
    }
}

function closeTo(actual, expected, message, epsilon = 0.5) {
    if (Math.abs(actual - expected) <= epsilon) {
        passed++;
    } else {
        failed++;
        console.error(`FAIL: ${message} (expected ~${expected}, got ${actual})`);
    }
}

function throws(fn, type, message) {
    try {
        fn();
        failed++;
        console.error(`FAIL: ${message} (expected ${type?.name ?? 'throw'})`);
    } catch (e) {
        if (type && !(e instanceof type)) {
            failed++;
            console.error(`FAIL: ${message} (threw ${e.name}, expected ${type.name})`);
        } else {
            passed++;
        }
    }
}

// ---------------------------------------------------------------- windows

function sampleWindow(overrides = {}) {
    return {
        status: 'ok',
        percent: 23,
        resetsAt: '2026-09-05T00:00:00.000Z',
        ...overrides,
    };
}

// 1. Normal usage response with all three windows.
{
    const snapshot = normalizeUsageResponse({
        usage: {
            rolling: sampleWindow({percent: 23}),
            weekly: sampleWindow({percent: 67}),
            monthly: sampleWindow({percent: 52}),
        },
    }, {fetchedAt: 1000});
    eq(snapshot.windows.length, 3, 'normal response has 3 windows');
    eq(snapshot.windows[0].id, 'rolling', 'first window id');
    eq(snapshot.windows[0].name, '5-hour', 'rolling name');
    eq(snapshot.windows[0].percent, 23, 'rolling percent');
    eq(snapshot.windows[1].percent, 67, 'weekly percent');
    eq(snapshot.fetchedAt, 1000, 'fetchedAt preserved');
}

// 2. Missing quota window.
{
    const snapshot = normalizeUsageResponse({
        usage: {rolling: sampleWindow({percent: 10})},
    });
    eq(snapshot.windows.length, 1, 'missing windows are skipped');
    eq(snapshot.windows[0].id, 'rolling', 'only rolling present');
}

// 3. Unknown quota window.
{
    const snapshot = normalizeUsageResponse({
        usage: {
            rolling: sampleWindow(),
            mystery_window: sampleWindow({percent: 5}),
        },
    });
    eq(snapshot.windows.length, 2, 'unknown window is included');
    eq(snapshot.windows[1].id, 'mystery_window', 'unknown id preserved');
    eq(snapshot.windows[1].name, 'Mystery Window', 'unknown id humanized');
}

// 4. Usage = 0%.
{
    const snapshot = normalizeUsageResponse({
        usage: {rolling: sampleWindow({percent: 0})},
    });
    eq(snapshot.windows[0].percent, 0, 'zero percent');
}

// 5. Usage = 100%.
{
    const snapshot = normalizeUsageResponse({
        usage: {weekly: sampleWindow({percent: 100})},
    });
    eq(snapshot.windows[0].percent, 100, 'full percent');
}

// 6. Usage > 100% is clamped to 100.
{
    const snapshot = normalizeUsageResponse({
        usage: {monthly: sampleWindow({percent: 140})},
    });
    eq(snapshot.windows[0].percent, 100, 'over-100 clamped');
}

// 7. Reset timestamp in seconds.
{
    const window = parseWindowFrom({resetsAt: 1750000000});
    ok(window.resetsAt instanceof Date, 'seconds timestamp parses');
    eq(window.resetsAt.getTime(), 1750000000 * 1000, 'seconds converted to ms');
}

// 8. Reset timestamp in milliseconds.
{
    const window = parseWindowFrom({resetsAt: 1750000000000});
    eq(window.resetsAt.getTime(), 1750000000000, 'ms timestamp preserved');
}

// 9. ISO timestamp string.
{
    const window = parseWindowFrom({resetsAt: '2026-09-05T00:00:00.000Z'});
    ok(window.resetsAt instanceof Date, 'ISO string parses');
    eq(window.resetsAt.getTime(), new Date('2026-09-05T00:00:00.000Z').getTime(), 'ISO value correct');
}

// 10. Missing fields -> window skipped.
{
    const snapshot = normalizeUsageResponse({
        usage: {rolling: {status: 'ok'}},
    });
    eq(snapshot.windows.length, 0, 'window without percent skipped');
}

// 11. Empty / malformed.
{
    const empty = normalizeUsageResponse({});
    ok(empty.isEmpty, 'empty response yields empty snapshot');
    const usageEmpty = normalizeUsageResponse({usage: {}});
    ok(usageEmpty.isEmpty, 'empty usage object yields empty snapshot');
    throws(() => normalizeUsageResponse(null), Errors.ParseError, 'null throws');
    throws(() => normalizeUsageResponse('nope'), Errors.ParseError, 'string throws');
    throws(() => normalizeUsageResponse([1, 2]), Errors.ParseError, 'array throws');
}

// 12. Inverse semantics: remainingPercent.
{
    const window = parseWindowFrom({remainingPercent: 77});
    closeTo(window.percent, 23, 'remainingPercent inverted');
}

// 13. used/limit fraction.
{
    const window = normalizeUsageResponse({
        usage: {rolling: {status: 'ok', used: 20, limit: 30, resetsAt: '2026-09-05T00:00:00.000Z'}},
    }).windows[0];
    closeTo(window.percent, 66.67, 'used/limit fraction to percent');
}

// 14. resetAt timestamp seconds stored in cache round-trip.
{
    const snapshot = normalizeUsageResponse({
        usage: {rolling: sampleWindow({percent: 40})},
    });
    const json = snapshot.toJSON();
    const restored = UsageSnapshot.fromJSON(json);
    ok(restored !== null, 'cache round-trip restores');
    eq(restored.windows[0].percent, 40, 'round-trip percent');
    ok(restored.windows[0].resetsAt instanceof Date, 'round-trip resetsAt is Date');
    eq(UsageSnapshot.fromJSON(null), null, 'fromJSON(null) is null');
    eq(UsageSnapshot.fromJSON({windows: 'x'}), null, 'fromJSON invalid windows is null');
}

// 15. HTTP status mapping.
{
    ok(classifyHttpStatus(401) instanceof Errors.AuthError, '401 -> AuthError');
    ok(classifyHttpStatus(403) instanceof Errors.EntitlementError, '403 -> EntitlementError');
    ok(classifyHttpStatus(404) instanceof Errors.ApiError, '404 -> ApiError');
    ok(classifyHttpStatus(500) instanceof Errors.ServerError, '500 -> ServerError');
    ok(classifyHttpStatus(502) instanceof Errors.ServerError, '502 -> ServerError');
    ok(classifyHttpStatus(418) instanceof Errors.ApiError, '418 -> ApiError');
    const rate = classifyHttpStatus(429, {retryAfterMs: 90000});
    ok(rate instanceof Errors.RateLimitedError, '429 -> RateLimitedError');
    eq(rate.retryAfterMs, 90000, 'retry-after passed through');
}

// 16. Network/timeout error types exist and are distinguishable.
{
    const network = new Errors.NetworkError();
    const timeout = new Errors.TimeoutError();
    const cancelled = new Errors.CancelledError();
    ok(network instanceof Errors.NetworkError, 'network error type');
    ok(timeout instanceof Errors.NetworkError, 'timeout is a network error');
    ok(cancelled instanceof Errors.CancelledError, 'cancelled error type');
    ok(!(cancelled instanceof Errors.NetworkError), 'cancelled is not a network error');
}

// 17. Retry-After parsing.
{
    eq(parseRetryAfter('30'), 30000, 'retry-after seconds');
    eq(parseRetryAfter(' 5 '), 5000, 'retry-after trimmed');
    ok(parseRetryAfter(undefined) === undefined, 'retry-after missing is undefined');
    eq(parseRetryAfter(''), undefined, 'retry-after empty is undefined');
}

// 18. Formatting helpers.
{
    eq(formatCountdown(30_000), '<1m', 'under a minute');
    eq(formatCountdown(28 * 60_000), '28m', 'minutes only');
    eq(formatCountdown((3 * 3600 + 42 * 60) * 1000), '3h 42m', 'hours and minutes');
    eq(formatCountdown((4 * 86400 + 8 * 3600) * 1000), '4d 8h', 'days and hours');
    eq(formatRelativeTime(0), 'just now', 'relative now');
    eq(formatRelativeTime(12 * 60_000), '12 min ago', 'relative minutes');
    eq(formatRelativeTime(5 * 3600_000), '5 hours ago', 'relative hours');
}

// 19. windowName mapping.
{
    eq(windowName('rolling'), '5-hour', 'rolling label');
    eq(windowName('weekly'), 'Weekly', 'weekly label');
    eq(windowName('monthly'), 'Monthly', 'monthly label');
    eq(windowName('daily'), 'Daily', 'daily label');
}

function parseWindowFrom(patch) {
    return normalizeUsageResponse({usage: {rolling: sampleWindow(patch)}}).windows[0];
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0)
    throw new Error(`${failed} test(s) failed`);