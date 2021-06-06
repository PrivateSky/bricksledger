require("../../../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const bricksledger = require("../../../../index");
const { launchApiHubTestNodeWithTestDomain } = require("../utils");

assert.callback(
    "Call a safe method without consensus using the executeSafeCommand",
    async (testFinished) => {
        try {
            const domain = "contract";

            const { validatorDID, rootFolder, domainConfig } = await $$.promisify(launchApiHubTestNodeWithTestDomain)();

            const initiliseBrickLedger = $$.promisify(bricksledger.initiliseBrickLedger);
            const bricksledgerInstance = await initiliseBrickLedger(validatorDID, domain, domainConfig, rootFolder, null);

            const command = bricksledger.createCommand({
                domain,
                contractName: "test",
                methodName: "safe",
                params: null,
                type: "safe",
            });

            const executionResult = await $$.promisify(bricksledgerInstance.executeSafeCommand)(command);
            console.log("executionResult", executionResult);

            executionResult
                .getOptimisticExecutionResult()
                .then((result) => {
                    assert.equal(result, "safe");
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
