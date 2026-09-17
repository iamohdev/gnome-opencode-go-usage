// OpenCode Go API client. Networking only; no UI logic.

import Soup from 'gi://Soup';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import * as Errors from './errors.js';
import {classifyHttpStatus, parseRetryAfter} from './http.js';
import {normalizeUsageResponse} from './usage.js';

const USAGE_URL = 'https://opencode.ai/zen/go/v1/usage';
const APP_USER_AGENT = 'opencode-go-usage-gnome/1.0';

function sendAndRead(session, message, cancellable) {
    return new Promise((resolve, reject) => {
        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable, (sess, result) => {
            try {
                const bytes = sess.send_and_read_finish(result);
                resolve(bytes);
            } catch (error) {
                reject(error);
            }
        });
    });
}

function mapNetworkError(message, error) {
    const status = message.status_code;
    const text = error?.message ?? '';

    if (status === 0 || /Operation was cancelled/i.test(text))
        return new Errors.CancelledError();
    if (/tim(e|eo)ut/i.test(text))
        return new Errors.TimeoutError();
    return new Errors.NetworkError();
}

export class OpenCodeGoApi {
    constructor({timeoutSeconds = 15, url = USAGE_URL} = {}) {
        this._url = url;
        this._timeoutSeconds = timeoutSeconds;
        this._session = new Soup.Session();
        this._session.timeout = timeoutSeconds;
        this._cancellable = Gio.Cancellable.new();
        this._inflight = null;
    }

    // Cancels any in-flight request. Safe to call multiple times.
    cancel() {
        this._cancellable.cancel();
    }

    // Coalesces concurrent calls into a single request.
    async getUsage(apiKey) {
        if (this._inflight)
            return this._inflight;
        this._inflight = this._fetch(apiKey).finally(() => {
            this._inflight = null;
        });
        return this._inflight;
    }

    async _fetch(apiKey) {
        const message = Soup.Message.new('GET', this._url);
        message.request_headers.append('Authorization', `Bearer ${apiKey}`);
        message.request_headers.append('Accept', 'application/json');
        message.request_headers.append('User-Agent', APP_USER_AGENT);

        let bytes;
        try {
            bytes = await sendAndRead(this._session, message, this._cancellable);
        } catch (error) {
            throw mapNetworkError(message, error);
        }

        const status = message.status_code;
        if (status !== Soup.Status.OK) {
            const retryAfter = parseRetryAfter(
                message.response_headers.get_one('Retry-After'));
            const error = classifyHttpStatus(status, {retryAfterMs: retryAfter});
            throw error ?? new Errors.ApiError(`Request failed (HTTP ${status}).`);
        }

        let text;
        try {
            text = new TextDecoder().decode(bytes.get_data());
        } catch {
            throw new Errors.ParseError('Response could not be decoded.');
        }

        let json;
        try {
            json = JSON.parse(text);
        } catch {
            throw new Errors.ParseError('Response was not valid JSON.');
        }

        try {
            return normalizeUsageResponse(json, {fetchedAt: Date.now()});
        } catch (error) {
            if (error instanceof Errors.ParseError)
                throw error;
            throw new Errors.ParseError();
        }
    }
}