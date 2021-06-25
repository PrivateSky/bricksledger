require("../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const ConsensusCore = require("../../src/ConsensusCore");
const { createTestFolder , launchApiHubTestNode} = require("../integration/utils");
const { getRandomInt, sleep } = require("../utils");

const { generatePBlockWithSingleCommand, assertSingleBlockFileEntry } = require("./utils");

const domain = "contract";

assert.callback(
    "Run consensus core addInConsensusAsync for multiple validators and single block with a single pBlock",
    async (testFinished) => {
        const rootFolder = await createTestFolder();
        await launchApiHubTestNode( async err => {
            const pBlocks = await Promise.all(
                Array.from(Array(getRandomInt(2, 5)).keys()).map((index) => generatePBlockWithSingleCommand(index))
            );

            console.log("pBlocks", pBlocks);

            const validators = pBlocks.map((pBlock) => ({DID: pBlock.validatorDID, URL: "validator-URL"}));

            const brickStorageMock = {
                addBrickAsync: async (block) => {
                    // consider pBlockHashLinkSSI to be the hash for simplicity
                    return block.hash;
                },
            };

            let executedPBlocksCount = 0;

            const executionEngineMock = {
                contracts: {
                    bdns: {
                        getDomainInfo: (callback) => {
                            callback(null, {
                                validators,
                            });
                        },
                    },
                },
                executePBlock: async (pBlock) => {
                    executedPBlocksCount++;
                },
            };

            const consensusCore = ConsensusCore.create(domain, rootFolder, null, brickStorageMock, executionEngineMock);
            await consensusCore.init();

            // simulate that all the validators are sending their blocks for validation
            for (let index = 0; index < pBlocks.length; index++) {
                const pBlock = pBlocks[index];
                consensusCore.addInConsensusAsync(pBlock);
                await sleep(100); // simulate that the pBlock won't arrive instantly
            }

            await sleep(1000); // wait for block consensus to finish

            assert.equal(
                pBlocks.length,
                executedPBlocksCount,
                `Expected executor to execute ${pBlocks.length} pBlocks, but only executed ${executedPBlocksCount}`
            );

            // check if latest block info has been updated
            assertSingleBlockFileEntry(rootFolder, consensusCore);

            testFinished();
        });
    },
    20000
);
