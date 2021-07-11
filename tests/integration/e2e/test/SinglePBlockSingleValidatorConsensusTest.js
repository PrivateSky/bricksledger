require("../../../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const { sleep } = require("../../../utils");
const { launchApiHubTestNodeWithContractAsync, assertBlockFileEntries } = require("../../utils");

assert.callback(
    "Run consensus core addInConsensusAsync for a single validator and single block with a single pBlock",
    async (testFinished) => {
        const domain = "contract";

        const { storageFolder } = await launchApiHubTestNodeWithContractAsync({
            maxPBlockSize: 1,
            maxPBlockTimeMs: 10000,
            pendingBlocksTimeoutMs: 1000,
        });

        const opendsu = require("opendsu");
        const contractsApi = opendsu.loadApi("contracts");

        const executionResult = await $$.promisify(contractsApi.generateSafeCommand)(domain, "test", "safeWithConsensus");
        assert.equal(executionResult.optimisticResult, "safeWithConsensus");

        await sleep(5000); // wait until block is created

        await assertBlockFileEntries(storageFolder, 1);

        testFinished();
    },
    20000
);
