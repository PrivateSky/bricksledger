require("../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const ConsensusCore = require("../../src/ConsensusCore");
const { createTestFolder } = require("../integration/utils");
const { generatePBlockWithSingleCommand, assertSingleBlockFileEntry } = require("./utils");

assert.callback(
    "Run consensus core addInConsensusAsync for a single validator and single block with a single pBlock",
    async (testFinished) => {
        const domain = "contract";

        const rootFolder = await createTestFolder();

        const pBlock = await generatePBlockWithSingleCommand();

        const brickStorageMock = {
            addBrickAsync: async (block) => {
                // consider pBlockHashLinkSSI to be the hash for simplicity
                return block.hash;
            },
        };

        const executionEngineMock = {
            contracts: {
                bdns: {
                    getDomainInfo: (callback) => {
                        callback(null, {
                            validators: [{ DID: "did", URL: "validator-URL" }],
                        });
                    },
                },
            },
            executePBlock: async (pBlock) => {
                // check if latest block info has been updated
                assertSingleBlockFileEntry(rootFolder, consensusCore);
            },
        };

        const consensusCore = ConsensusCore.create(domain, rootFolder, null, brickStorageMock, executionEngineMock);
        await consensusCore.init();

        await consensusCore.addInConsensusAsync(pBlock);
        testFinished();
    },
    10000
);
