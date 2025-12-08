/**
 * Shim for fs/promises
 *
 * Node.js v12 has fs.promises but not the fs/promises module import.
 * This shim provides backward compatibility for nodejs-mobile.
 */
module.exports = require('fs').promises;
