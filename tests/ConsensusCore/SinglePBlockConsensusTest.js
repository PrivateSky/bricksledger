require("../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const Command = require("../../src/Command");
const PBlock = require("../../src/PBlock");
const ConsensusCore = require("../../src/ConsensusCore");
const { createTestFolder } = require("../integration/utils");

assert.callback(
    "Run consensus core addInConsensusAsync for a single validator and single block with a single pBlock",
    async (testFinished) => {
        const domain = "contract";

        const latestBlockHash = "latestBlockHash";
        const latestBlockNumber = 1;

        const rootFolder = await createTestFolder();

        const w3cDID = require("opendsu").loadApi("w3cdid");
        const validatorDID = await $$.promisify(w3cDID.createIdentity)("demo", "id");

        const command = new Command({
            domain,
            contractName: "test",
            methodName: "nonced",
            params: null,
            type: "nonced",
            timestamp: Date.now(),
            signerDID: validatorDID.getIdentifier(),
        });

        const pBlockInfo = {
            validatorDID: validatorDID.getIdentifier(),
            commands: [command],
            previousBlockHash: latestBlockHash,
            blockNumber: latestBlockNumber + 1,
        };
        const pBlock = new PBlock(pBlockInfo);
        pBlock.hash = pBlock.computeHash();
        pBlock.validatorSignature = validatorDID.sign(pBlock.hash);
        const pBlockHashLink = "pBlockHashLinkSSI";

        const brickStorageMock = {
            addBrickAsync: async (block) => {
                return "new-block-hash";
            },
        };

        const executionEngineMock = {
            contracts: {
                bdns: {
                    getDomainInfo: async () => {
                        return {
                            validators: ["validator-URL"],
                        };
                    },
                },
            },
            executePBlock: async (pBlock) => {
                // check if latest block info has been updated
                const validatedBlocksFilePath = require("path").join(rootFolder, "domains", domain, "blocks");
                const validatedBlocksFileContent = require("fs").readFileSync(validatedBlocksFilePath).toString().trim();
                const validatedBlocksLines = validatedBlocksFileContent.split(/\r?\n/);

                assert.equal(
                    validatedBlocksLines.length,
                    1,
                    "Expected consensus to append a single block hash inside the blocks file"
                );

                const newlyAddedBlockHash = validatedBlocksLines[0];

                const latestBlockInfo = consensusCore.getLatestBlockInfo();
                assert.equal(latestBlockInfo.number, latestBlockNumber + 1, "Expected to increment block number");
                assert.equal(
                    latestBlockInfo.hash,
                    newlyAddedBlockHash,
                    "Expected latest block hash to be the hash of the newly created block"
                );
            },
        };

        const consensusCore = ConsensusCore.create(domain, rootFolder, brickStorageMock, executionEngineMock);
        await consensusCore.init();

        await consensusCore.addInConsensusAsync(pBlock, pBlockHashLink);
        testFinished();
    },
    10000
);
