function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkIfPathExists(path) {
    try {
        const fs = require("fs");
        await $$.promisify(fs.access)(path);
        return true;
    } catch (error) {
        return false;
    }
}

async function ensurePathExists(path) {
    const pathExists = await checkIfPathExists(path);
    if (!pathExists) {
        const fs = require("fs");
        await $$.promisify(fs.mkdir)(path, { recursive: true });
    }
}

module.exports = {
    getRandomInt,
    sleep,
    checkIfPathExists,
    ensurePathExists,
};
