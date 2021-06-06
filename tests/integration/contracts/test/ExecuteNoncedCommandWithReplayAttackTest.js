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
                timestamp,
                signerDID: validatorDID.getIdentifier(),
            };
            let command = bricksledger.createCommand(commandBody);

            const requesterSignature = validatorDID.sign(command.getHash());
            command = bricksledger.createCommand({ ...commandBody, requesterSignature });

            const executionResult = await $$.promisify(bricksledgerInstance.executeNoncedCommand)(command);
            console.log("executionResult", executionResult);

            executionResult
                .getOptimisticExecutionResult()
                .then((result) => {
                    assert.equal(result, "nonced");
                })
                .catch((error) => {
                    throw error;
                });

            try {
                const replayExecutionResult = await $$.promisify(bricksledgerInstance.executeNoncedCommand)(command);
                console.log("replayExecutionResult", replayExecutionResult);
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
