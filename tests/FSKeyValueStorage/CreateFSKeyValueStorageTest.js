require("../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const FSKeyValueStorage = require("../../src/FSKeyValueStorage");

assert.callback("Create FSKeyValueStorage test", async (testFinished) => {
    const fSKeyValueStorage = FSKeyValueStorage.createInstance();
    assert.true(fSKeyValueStorage != null);

    testFinished();
});
