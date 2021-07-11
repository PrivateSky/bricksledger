require("../../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const bricksledger = require("../../../index");
const { launchApiHubTestNodeWithContractAsync } = require("../utils");

assert.callback(
    "Bricksledger Call a safe method with consensus using the executeSafeCommand",
    async (testFinished) => {
        const domain = "contract";

        const { validatorDID, validatorURL, rootFolder, storageFolder, domainConfig } =
            await launchApiHubTestNodeWithContractAsync({
                maxPBlockSize: 1,
                maxPBlockTimeMs: 10000,
                pendingBlocksTimeoutMs: 1000,
            });

        const initiliseBrickLedger = $$.promisify(bricksledger.initiliseBrickLedger);
        const bricksledgerInstance = await initiliseBrickLedger(
            validatorDID,
            validatorURL,
            domain,
            domainConfig,
            rootFolder,
            storageFolder
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
