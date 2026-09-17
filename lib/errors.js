// Error types used across the extension.
// These are intentionally pure (no GI imports) so they can be unit-tested.

export class UsageError extends Error {
    constructor(message, options = {}) {
        super(message);
        this.name = new.target.name;
        this.retryAfterMs = options.retryAfterMs;
    }
}

export class NoApiKeyError extends UsageError {
    constructor(message = 'API key not configured.') {
        super(message);
    }
}

export class AuthError extends UsageError {
    constructor(message = 'Authentication failed.') {
        super(message);
    }
}

export class EntitlementError extends UsageError {
    constructor(message = 'OpenCode Go subscription required.') {
        super(message);
    }
}

export class RateLimitedError extends UsageError {
    constructor(message = 'Too many requests.', options = {}) {
        super(message, options);
    }
}

export class ServerError extends UsageError {
    constructor(message = 'Server error.') {
        super(message);
    }
}

export class ApiError extends UsageError {
    constructor(message = 'Request failed.') {
        super(message);
    }
}

export class NetworkError extends UsageError {
    constructor(message = 'Unable to reach OpenCode.') {
        super(message);
    }
}

export class TimeoutError extends NetworkError {
    constructor(message = 'Request timed out.') {
        super(message);
    }
}

export class ParseError extends UsageError {
    constructor(message = 'Unexpected API response.') {
        super(message);
    }
}

export class CancelledError extends UsageError {
    constructor(message = 'Request cancelled.') {
        super(message);
    }
}

export class SecretError extends UsageError {
    constructor(message = 'Unable to use the Secret Service.') {
        super(message);
    }
}