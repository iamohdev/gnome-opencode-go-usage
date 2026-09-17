// Import smoke test for the GI-backed modules that can load outside GNOME Shell.
// Run with: gjs -m tests/imports.js

import '../lib/api.js';
import '../lib/cache.js';
import '../lib/secrets.js';
import '../lib/errors.js';
import '../lib/http.js';
import '../lib/utils.js';
import '../lib/usage.js';

console.log('imports OK');