require("../../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const { sleep } = require("../../utils");
const { launchApiHubTestNodeWithContractAsync } = require("../utils");

const domain = "contract";

async function launchApiHubTestNodeWithMultipleValidators(initialCommandCount, totalNumberOfValidators) {
    const mainValidator = await launchApiHubTestNodeWithContractAsync(
        {
            maxPBlockSize: 1,
            maxPBlockTimeMs: 10000,
            pendingBlocksTimeoutMs: 10000,
        },
        {
            useWorker: true,
        }
    );

    const opendsu = require("opendsu");
    const contractsApi = opendsu.loadApi("contracts");
    const generateSafeCommand = $$.promisify(contractsApi.generateSafeCommandForSpecificServer);
    const generateNoncedCommand = $$.promisify(contractsApi.generateNoncedCommandForSpecificServer);

    for (let i = 0; i < initialCommandCount; i++) {
        await generateNoncedCommand(mainValidator.validatorURL, mainValidator.validatorDID, domain, "test", "nonced");
    }

    for (let i = 0; i < totalNumberOfValidators - 1; i++) {
        await sleep(10000); // simulate delay when a new node wants to join as a validator

        const node = await launchApiHubTestNodeWithContractAsync(
            {
                maxPBlockSize: 1,
                maxPBlockTimeMs: 10000,
                pendingBlocksTimeoutMs: 10000,
            },
            {
                validators: [{ DID: mainValidator.validatorDID, URL: mainValidator.validatorURL }],
                useWorker: true,
            }
        );
        console.log(`Adding new node ${node.validatorDID} to ${mainValidator.validatorDID}...`);

        const executionResult = await generateSafeCommand(node.validatorURL, domain, "consensus", "getLatestBlockInfo");
        const latestBlockInfo = executionResult.optimisticResult;
        console.log("latestBlockInfo is", latestBlockInfo);
        const expectedCurrentBlockNumber = initialCommandCount + i + 1; // each new node will trigger a nonced command when requesting to be added as validator
        assert.equal(
            latestBlockInfo.number,
            expectedCurrentBlockNumber,
            `Expected current block number to be ${expectedCurrentBlockNumber}, but is ${latestBlockInfo.number}`
        );
    }
}

module.exports = {
    launchApiHubTestNodeWithMultipleValidators,
};
