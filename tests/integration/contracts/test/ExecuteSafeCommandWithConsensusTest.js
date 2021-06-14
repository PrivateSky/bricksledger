require("../../../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const bricksledger = require("../../../../index");
const { launchApiHubTestNodeWithTestDomain } = require("../utils");

assert.callback(
    "Call a safe method with consensus using the executeSafeCommand",
    async (testFinished) => {
        try {
            const domain = "contract";

            const { validatorDID, rootFolder, domainConfig } = await $$.promisify(launchApiHubTestNodeWithTestDomain)();

            const initiliseBrickLedger = $$.promisify(bricksledger.initiliseBrickLedger);
            const bricksledgerInstance = await initiliseBrickLedger(validatorDID, domain, domainConfig, rootFolder, null);

            const command = bricksledger.createCommand({
                domain,
                contractName: "test",
                methodName: "safeWithConsensus",
                params: null,
                type: "safe",
            });

            const executionResult = await $$.promisify(bricksledgerInstance.executeSafeCommand)(command);

            executionResult
                .getOptimisticExecutionResult()
                .then((result) => {
                    assert.equal(result, "safeWithConsensus");
                    testFinished();
                })
                .catch((error) => {
                    throw error;
                });
        } catch (error) {
            console.error(error);
        }
    },
    10000
);
