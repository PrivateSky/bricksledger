async function ensurePathExists(path) {
    const fs = require("fs");
    try {
        await $$.promisify(fs.access)(path);
    } catch (error) {
        // base folder doesn't exists, so we create it
        await $$.promisify(fs.mkdir)(path, { recursive: true });
    }
}

module.exports = {
    ensurePathExists
}