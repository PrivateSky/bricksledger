require("../../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const { launchApiHubTestNodeWithContractAsync } = require("../utils");
const { getRandomInt, writeHashesToValidatedBlocksFile, getHashLinkSSIString } = require("../../utils");

assert.callback(
    "Booting bricksledger with a single self validator present with random block already executed",
    async (testFinished) => {
        const domain = "contract";

        const blockHashes = Array.from(Array(getRandomInt(100, 200)).keys()).map((index) =>
            getHashLinkSSIString(domain, `block-hash-${index}`)
        );

        await launchApiHubTestNodeWithContractAsync(
            {
                maxPBlockSize: 1,
                maxPBlockTimeMs: 10000,
                pendingBlocksTimeoutMs: 1000,
            },
            {
                onBeforeServerStart: async ({ storageFolder }) => {
                    await writeHashesToValidatedBlocksFile(storageFolder, domain, blockHashes);
                },
            }
        );

        const opendsu = require("opendsu");
        const contractsApi = opendsu.loadApi("contracts");

        const executionResult = await $$.promisify(contractsApi.generateSafeCommand)(domain, "consensus", "getLatestBlockInfo");
        const latestBlockInfo = executionResult.optimisticResult;

        assert.equal(
            latestBlockInfo.number,
            blockHashes.length,
            `Expected to have ${blockHashes.length} blocks loaded, but received only ${latestBlockInfo.number}`
        );
        assert.equal(latestBlockInfo.hash, blockHashes[blockHashes.length - 1]);

        testFinished();
    },
    10000000
);
