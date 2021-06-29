require("../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const ConsensusCore = require("../../src/ConsensusCore");
const { createTestFolder } = require("../integration/utils");
const { getRandomInt, sleep } = require("../utils");

const { writeHashesToValidatedBlocksFile, generatePBlockWithSingleCommand, assertBlockFileEntries, parseValidatorDID } = require("./utils");

const domain = "contract";

assert.callback(
    "Run consensus core addInConsensusAsync for multiple validators and single block with multiple random pBlock, but with some pBlocks arriving after block timeout",
    async (testFinished) => {
        const rootFolder = await createTestFolder();
        await writeHashesToValidatedBlocksFile(rootFolder, domain, ["latestBlockHash"]);

        const pBlocks = await Promise.all(
            Array.from(Array(getRandomInt(4, 6)).keys()).map((index) => generatePBlockWithSingleCommand(index))
        );

        console.log(`Constructed ${pBlocks.length} pBlocks`);

        const validator = await parseValidatorDID(pBlocks[0].validatorDID);
        const validators = pBlocks.map((pBlock) => ({ DID: pBlock.validatorDID, URL: "validator-URL" }));

        const pBlocksCountToRemove = getRandomInt(1, pBlocks.length - 2);
        const latePBlocks = pBlocks.splice(0, pBlocksCountToRemove);

        console.log(
            `Removing ${pBlocksCountToRemove} pBlocks so that ${latePBlocks.length} blocks will enter consensus later than the timeout`
        );

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

        const validatorContractExecutorFactoryMock = {
            create: () => {
                return {
                    getValidatorsAsync: async () => validators,
                    getLatestBlockInfoAsync: async () => ({ number: 1, hash: "latestBlockHash" }),
                };
            },
        };

        const blockTimeoutMs = 1000 * 3; // 3 seconds
        const consensusCore = ConsensusCore.create(
            validator,
            null,
            domain,
            rootFolder,
            blockTimeoutMs,
            brickStorageMock,
            executionEngineMock,
            validatorContractExecutorFactoryMock
        );
        await consensusCore.boot();

        // simulate that all the remaining validators are sending their blocks for validation
        for (let index = 0; index < pBlocks.length; index++) {
            const pBlock = pBlocks[index];
            consensusCore.addInConsensusAsync(pBlock);
            await sleep(100); // simulate that the pBlock won't arrive instantly
        }

        await sleep(4000); // wait for timeout to occur

        // simulate some pBlocks that have arrived after block timeout
        for (let index = 0; index < latePBlocks.length; index++) {
            const pBlock = latePBlocks[index];

            try {
                await consensusCore.addInConsensusAsync(pBlock);
                assert.true(false, "shouldn't be able to add pBlock after block timeout has been reached");
            } catch (error) {
                assert.notNull(error);
            }
        }

        assert.equal(
            pBlocks.length,
            executedPBlocksCount,
            `Expected executor to execute ${pBlocks.length} pBlocks, but only executed ${executedPBlocksCount}`
        );

        const expectedValidatedBlockCount = 2;
        await assertBlockFileEntries(rootFolder, consensusCore, expectedValidatedBlockCount);

        testFinished();
    },
    10000
);
