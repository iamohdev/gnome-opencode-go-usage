// Non-secret cache of the last successful usage snapshot.
// Stored under the user cache directory; the API key is never cached here.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {UsageSnapshot} from './usage.js';

const CACHE_DIR = GLib.build_filenamev([GLib.get_user_cache_dir(), 'opencode-go-usage']);
const CACHE_FILE = GLib.build_filenamev([CACHE_DIR, 'usage.json']);

export class UsageCache {
    constructor({file = CACHE_FILE} = {}) {
        this._file = file;
    }

    // Resolves to a UsageSnapshot or null; never rejects.
    load() {
        return new Promise(resolve => {
            const file = Gio.File.new_for_path(this._file);
            file.load_contents_async(null, (source, result) => {
                try {
                    const [, contents] = source.load_contents_finish(result);
                    const text = new TextDecoder().decode(contents);
                    const json = JSON.parse(text);
                    resolve(UsageSnapshot.fromJSON(json));
                } catch {
                    resolve(null);
                }
            });
        });
    }

    save(snapshot) {
        try {
            const dir = Gio.File.new_for_path(GLib.path_get_dirname(this._file));
            dir.make_directory_with_parents(null);
            const file = Gio.File.new_for_path(this._file);
            const payload = new TextEncoder().encode(JSON.stringify(snapshot.toJSON()));
            file.replace_contents(
                payload, null, false, Gio.FileCreateFlags.NONE, null);
        } catch {
            // Caching is best-effort; never break the extension over a cache write.
        }
    }
}