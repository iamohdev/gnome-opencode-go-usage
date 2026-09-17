// Pure HTTP status/header classification. Split out of the network layer so it
// can be unit-tested without a Soup session.

import * as Errors from './errors.js';

export function classifyHttpStatus(status, {retryAfterMs} = {}) {
    if (status === 401)
        return new Errors.AuthError('Authentication failed.');
    if (status === 403)
        return new Errors.EntitlementError('OpenCode Go subscription required.');
    if (status === 429)
        return new Errors.RateLimitedError('Too many requests.', {retryAfterMs});
    if (status === 404)
        return new Errors.ApiError('Endpoint not found (HTTP 404).');
    if (status >= 500 && status < 600)
        return new Errors.ServerError(`Server error (HTTP ${status}).`);
    if (status >= 400 && status < 500)
        return new Errors.ApiError(`Request failed (HTTP ${status}).`);
    return new Errors.ApiError(`Unexpected response (HTTP ${status}).`);
}

// Retry-After may be "seconds" or an HTTP date.
export function parseRetryAfter(value) {
    if (!value)
        return undefined;
    const trimmed = String(value).trim();
    if (trimmed === '')
        return undefined;
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds) && seconds >= 0)
        return seconds * 1000;
    const date = Date.parse(trimmed);
    if (Number.isFinite(date))
        return Math.max(0, date - Date.now());
    return undefined;
}