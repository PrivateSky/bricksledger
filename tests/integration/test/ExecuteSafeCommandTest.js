require("../../../../../psknode/bundles/testsRuntime");

const path = require("path");
const dc = require("double-check");
const assert = dc.assert;

const bricksledger = require("../../../index");
const { launchApiHubTestNodeWithContractAsync } = require("../utils");

assert.callback(
    "Bricksledger Call a safe method without consensus using the executeSafeCommand",
    async (testFinished) => {
        const domain = "contract";

        const { validatorDID, validatorURL, rootFolder, storageFolder, domainConfig } =
            await launchApiHubTestNodeWithContractAsync();

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
    20000
);
