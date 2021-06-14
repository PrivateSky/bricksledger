require("../../../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const bricksledger = require("../../../../index");
const { launchApiHubTestNodeWithTestDomain } = require("../utils");

assert.callback(
    "Call the same nonced method using the executeNoncedCommand, simulating a replay attack",
    async (testFinished) => {
        try {
            const domain = "contract";

            const { validatorDID, rootFolder, domainConfig } = await $$.promisify(launchApiHubTestNodeWithTestDomain)();

            const initiliseBrickLedger = $$.promisify(bricksledger.initiliseBrickLedger);
            const bricksledgerInstance = await initiliseBrickLedger(validatorDID, domain, domainConfig, rootFolder, null);

            const timestamp = Date.now();
            const commandBody = {
                domain,
                contractName: "test",
                methodName: "nonced",
                params: null,
                type: "nonced",
                blockNumber: 0,
                timestamp,
                signerDID: validatorDID.getIdentifier(),
            };
            let command = bricksledger.createCommand(commandBody);

            const requesterSignature = validatorDID.sign(command.getHash());
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
        } catch (error) {
            console.error(error);
        }
    },
    10000
);
