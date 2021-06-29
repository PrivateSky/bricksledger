require("../../../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const bricksledger = require("../../../../index");
const { launchApiHubTestNodeWithTestDomainAsync } = require("../utils");

assert.callback(
    "Call a safe method without consensus using the executeSafeCommand",
    async (testFinished) => {
        const domain = "contract";

        const { validatorDID, validatorURL, rootFolder, domainConfig } = await launchApiHubTestNodeWithTestDomainAsync();

        const initiliseBrickLedger = $$.promisify(bricksledger.initiliseBrickLedger);
        const bricksledgerInstance = await initiliseBrickLedger(
            validatorDID,
            validatorURL,
            domain,
            domainConfig,
            rootFolder,
            null
        );

        const command = bricksledger.createCommand({
            domain,
            contractName: "test",
            methodName: "safe",
            params: null,
            type: "safe",
        });

        const executionResult = await $$.promisify(bricksledgerInstance.executeSafeCommand)(command);

        executionResult
            .getOptimisticExecutionResult()
            .then((result) => {
                assert.equal(result, "safe");
                testFinished();
            })
            .catch((error) => {
                throw error;
            });
    },
    10000
);
