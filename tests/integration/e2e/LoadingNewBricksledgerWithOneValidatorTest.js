require("../../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const { getRandomInt } = require("../../utils");
const { launchApiHubTestNodeWithMultipleValidators } = require("./utils");

assert.callback(
    "Booting the leadger with a single clean validator (without already executed block) that beings generating a block, and adding 1 other validator in the consensus",
    async (testFinished) => {
        await launchApiHubTestNodeWithMultipleValidators(getRandomInt(1, 5), 1);
        testFinished();
    },
    1000 * 60 * 3
);
