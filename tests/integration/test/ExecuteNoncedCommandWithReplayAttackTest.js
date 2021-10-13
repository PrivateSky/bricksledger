require("../../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const bricksledger = require("../../../index");
const { launchApiHubTestNodeWithContractAsync } = require("../utils");

assert.callback(
    "Bricksledger Call the same nonced method using the executeNoncedCommand, simulating a replay attack",
    async (testFinished) => {
        const domain = "contract";

        const { validatorDID, validatorURL, validatorDIDInstance, rootFolder, storageFolder, domainConfig } =
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

        const timestamp = Date.now();
        const commandBody = {
            domain,
            contractName: "test",
            methodName: "nonced",
            params: null,
            type: "nonced",
            blockNumber: 0,
            timestamp,
            signerDID: validatorDID,
        };
        let command = bricksledger.createCommand(commandBody);

        const requesterSignature = await validatorDIDInstance.sign(command.getHash());
        command = bricksledger.createCommand({ ...commandBody, requesterSignature });

        const executionResult = await $$.promisify(bricksledgerInstance.executeNoncedCommand)(command);

        const optimisticResult = await executionResult.getOptimisticExecutionResult();
        assert.equal(optimisticResult, "nonced");

        try {
            const replayExecutionResult = await $$.promisify(bricksledgerInstance.executeNoncedCommand)(command);
            assert.true(false, "shouldn't be able to call the same contract method using the same timestamp/signature");
        } catch (error) {
            console.log(error);
            assert.notNull(error);
        }

        testFinished();
    },
    20000
);
