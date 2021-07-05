require("../../../../psknode/bundles/testsRuntime");
const dc = require("double-check");

let counter = 0;
async function createTestFolder(name) {
    if (!name) {
        name = `test-${counter++}`;
    }
    const folder = await $$.promisify(dc.createTestFolder)(name);
    return folder;
}

module.exports = {
    createTestFolder,
};
