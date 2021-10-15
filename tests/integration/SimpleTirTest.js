require("../../../../psknode/bundles/testsRuntime");
const {launchApiHubTestNode} = require("../../../../psknode/tests/util/tir");

const dc = require("double-check");
const assert = dc.assert;

const bricksledger = require("../../index");
const tir = require("../../../../psknode/tests/util/tir");

assert.callback(
    "Simple TIR test",
    async (testFinished) => {
        dc.createTestFolder('AddFilesBatch', async (err, folder) => {
                const result = await $$.promisify(launchApiHubTestNode)(100, folder);
                assert.notNull(result);

                testFinished();
            });
    },
    20000
);
