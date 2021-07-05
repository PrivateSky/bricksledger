require("../../../../psknode/bundles/testsRuntime");
const { launchApiHubTestNode } = require("../../../../psknode/tests/util/tir");

const dc = require("double-check");
const assert = dc.assert;

const bricksledger = require("../../index");

assert.callback(
    "Simple TIR test",
    async (testFinished) => {
        try {
            const result = await $$.promisify(launchApiHubTestNode)();
            assert.notNull(result);

            testFinished();
        } catch (error) {
            console.error(error);
        }
    },
    20000
);
