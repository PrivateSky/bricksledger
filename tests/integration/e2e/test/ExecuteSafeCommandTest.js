require("../../../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const { launchApiHubTestNodeWithContractAsync, assertEmptyBlockFile } = require("../../utils");

assert.callback(
    "Call a safe method without consensus using the executeSafeCommand",
    async (testFinished) => {
        const domain = "contract";

        const { storageFolder } = await launchApiHubTestNodeWithContractAsync({
            maxPBlockSize: 1,
            maxPBlockTimeMs: 10000,
            pendingBlocksTimeoutMs: 1000,
        });

        const opendsu = require("opendsu");
        const contractsApi = opendsu.loadApi("contracts");

        const executionResult = await $$.promisify(contractsApi.generateSafeCommand)(domain, "test", "safe");
        assert.equal(executionResult.optimisticResult, "safe");

        assertEmptyBlockFile(storageFolder);

        testFinished();
    },
    20000
);
