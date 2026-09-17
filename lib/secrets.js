// Secure API-key storage through the freedesktop Secret Service (libsecret).
// No plaintext fallback: if the secret service is unavailable we surface a clear error.

import * as Errors from './errors.js';

const SCHEMA_NAME = 'org.gnome.shell.extensions.opencode-go-usage';
const ATTRIBUTE_KEY = 'extension';
const ATTRIBUTE_VALUE = 'opencode-go-usage';
const ATTRIBUTES = {[ATTRIBUTE_KEY]: ATTRIBUTE_VALUE};

let _secretPromise = null;

function loadSecret() {
    if (!_secretPromise) {
        _secretPromise = import('gi://Secret')
            .then(mod => mod.default ?? mod)
            .catch(() => {
                _secretPromise = null;
                throw new Errors.SecretError(
                    'The libsecret bindings are not installed.');
            });
    }
    return _secretPromise;
}

function makeSchema(Secret) {
    return Secret.Schema.new(SCHEMA_NAME, Secret.SchemaFlags.NONE, {
        [ATTRIBUTE_KEY]: Secret.SchemaAttributeType.STRING,
    });
}

export class SecretStore {
    constructor({label = 'OpenCode Go Usage API key'} = {}) {
        this._label = label;
    }

    async load() {
        const Secret = await loadSecret();
        const schema = makeSchema(Secret);
        try {
            const value = await new Promise((resolve, reject) => {
                Secret.password_lookup(schema, ATTRIBUTES, null, (source, result) => {
                    try {
                        resolve(Secret.password_lookup_finish(result) ?? null);
                    } catch (error) {
                        reject(error);
                    }
                });
            });
            return typeof value === 'string' && value !== '' ? value : null;
        } catch (error) {
            throw new Errors.SecretError('Unable to read the API key from the Secret Service.');
        }
    }

    // Passing null/'' removes the stored key.
    async store(value) {
        const Secret = await loadSecret();
        const schema = makeSchema(Secret);
        const cleaned = value == null ? '' : String(value).trim();
        try {
            if (cleaned === '') {
                await new Promise((resolve, reject) => {
                    Secret.password_clear(schema, ATTRIBUTES, null, (source, result) => {
                        try {
                            resolve(Secret.password_clear_finish(result));
                        } catch (error) {
                            reject(error);
                        }
                    });
                });
            } else {
                await new Promise((resolve, reject) => {
                    Secret.password_store(
                        schema, ATTRIBUTES, Secret.COLLECTION_DEFAULT,
                        this._label, cleaned, null, (source, result) => {
                            try {
                                resolve(Secret.password_store_finish(result));
                            } catch (error) {
                                reject(error);
                            }
                        });
                });
            }
        } catch (error) {
            throw new Errors.SecretError('Unable to store the API key in the Secret Service.');
        }
    }
}