require("../../../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const bricksledger = require("../../../../index");
const { launchApiHubTestNodeWithContractAsync } = require("../contract-utils");

assert.callback(
    "Call a safe method with consensus using the executeSafeCommand",
    async (testFinished) => {
        const domain = "contract";

        const { validatorDID, validatorURL, storageFolder, domainConfig } = await launchApiHubTestNodeWithContractAsync();

        const config = {
            maxPBlockSize: 1,
            maxPBlockTimeMs: 10000,
            maxBlockTimeMs: 1000,
        };
        const initiliseBrickLedger = $$.promisify(bricksledger.initiliseBrickLedger);
        const bricksledgerInstance = await initiliseBrickLedger(
            validatorDID,
            validatorURL,
            domain,
            domainConfig,
            storageFolder,
            null,
            config
        );

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
    },
    20000
);
