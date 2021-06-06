require("../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const FSKeyValueStorage = require("../../src/FSKeyValueStorage");

assert.callback("Create FSKeyValueStorage test", async (testFinished) => {
    const domain = "contract";
    const rootFolder = __dirname;
    const contractName = "anchoring";

    const fSKeyValueStorage = FSKeyValueStorage.create(domain, rootFolder, contractName);
    assert.true(fSKeyValueStorage != null);

    testFinished();
});
