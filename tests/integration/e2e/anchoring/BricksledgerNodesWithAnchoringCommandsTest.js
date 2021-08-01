require("../../../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const { launchNodesWithCommandRequiringConsensusGeneratorAndConsistencyChecks } = require("../e2e-utils");

const opendsu = require("opendsu");
const keySSIApi = opendsu.loadApi("keyssi");

const domain = "contract";

assert.callback(
    "Booting the leadger with 5 nodes, and then generating random anchoring commands",
    async (testFinished) => {
        const nodeCount = 10;
        const commandCount = 1000;
        const commandGenerator = async ({ generateSafeCommand }) => {
            const seedSSI = keySSIApi.createSeedSSI(domain);
            const anchorId = seedSSI.getAnchorId();

            const createAnchorCommand = await generateSafeCommand("anchoring", "createAnchor", [anchorId]);
            return createAnchorCommand;
        };

        const contractsConfig = {
            maxPBlockSize: 10,
            maxPBlockTimeMs: 10000,
            pendingBlocksTimeoutMs: 10000,
        };

        await launchNodesWithCommandRequiringConsensusGeneratorAndConsistencyChecks(
            nodeCount,
            commandCount,
            commandGenerator,
            testFinished,
            contractsConfig
        );
    },
    1000 * 60 * 10
);
