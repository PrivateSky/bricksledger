require("../../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const { getRandomInt } = require("../../utils");
const { launchApiHubTestNodeWithMultipleValidators } = require("./e2e-utils");

assert.callback(
    "Booting the leadger with a single clean validator (without already executed block) that beings generating a block",
    async (testFinished) => {
        await launchApiHubTestNodeWithMultipleValidators(1, getRandomInt(1, 5));
        testFinished();
    },
    1000 * 60 * 3
);
