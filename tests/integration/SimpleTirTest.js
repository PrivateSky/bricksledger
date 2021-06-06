require("../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const bricksledger = require("../../index");
const { launchApiHubTestNode } = require("./utils");

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
    10000
);
