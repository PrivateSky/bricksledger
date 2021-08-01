require("../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const ConsensusCore = require("../../src/ConsensusCore");

const {
    getRandomInt,
    sleep,
    createTestFolder,
    writeHashesToValidatedBlocksFile,
    generatePBlockWithSingleCommand,
    assertBlockFileEntries,
    parseValidatorDID,
} = require("../utils");

const domain = "contract";

assert.callback(
    "Run consensus core addInConsensusAsync for multiple validators and single block with a multiple random pBlock",
    async (testFinished) => {
        const rootFolder = await createTestFolder();
        await writeHashesToValidatedBlocksFile(rootFolder, domain, ["latestBlockHash"]);

        const pBlocks = await Promise.all(
            Array.from(Array(getRandomInt(2, 5)).keys()).map((index) => generatePBlockWithSingleCommand(index))
        );
        console.log(`Constructed ${pBlocks.length} pBlocks`);

        const validator = await parseValidatorDID(pBlocks[0].validatorDID);
        const validators = pBlocks.map((pBlock) => ({ DID: pBlock.validatorDID, URL: "validator-URL" }));

        let executedPBlocksCount = 0;

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
                            validators,
                        });
                    },
                },
            },
            executePBlock: async (pBlock) => {
                executedPBlocksCount++;
            },
        };

        const broadcasterMock = {};

        const notifierMock = {
            notifyNewBlock: (blockInfo) => {
                console.log("Notifying new block", blockInfo);
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

        const consensusCore = ConsensusCore.create(
            validator,
            null,
            domain,
            rootFolder,
            brickStorageMock,
            executionEngineMock,
            broadcasterMock,
            notifierMock,
            null,
            null,
            validatorContractExecutorFactoryMock
        );
        await consensusCore.boot();

        // simulate that all the validators are sending their blocks for validation
        for (let index = 0; index < pBlocks.length; index++) {
            const pBlock = pBlocks[index];
            consensusCore.addInConsensusAsync(pBlock);
            await sleep(100); // simulate that the pBlock won't arrive instantly
        }

        await sleep(5000); // wait for block consensus to finish

        assert.equal(
            pBlocks.length - 1, // the validator's own pBlock won't be executed again since it was executed when commands were being executed
            executedPBlocksCount,
            `Expected executor to execute ${pBlocks.length - 1} pBlocks, but only executed ${executedPBlocksCount}`
        );

        const expectedValidatedBlockCount = 2;
        await assertBlockFileEntries(rootFolder, consensusCore, expectedValidatedBlockCount);

        testFinished();
    },
    10000
);
