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
    "Run consensus core addInConsensusAsync for multiple validators and single block with multiple random pBlock, but with one validator (the same for all) becoming unreachable for all other validators, but with the pending blocks arriving after timeout",
    async (testFinished) => {
        const rootFolder = await createTestFolder();
        await writeHashesToValidatedBlocksFile(rootFolder, domain, ["latestBlockHash"]);

        const pBlocks = await Promise.all(
            Array.from(Array(getRandomInt(4, 6)).keys()).map((index) => generatePBlockWithSingleCommand(index))
        );

        console.log(`Constructed ${pBlocks.length} pBlocks`);

        const validator = await parseValidatorDID(pBlocks[0].validatorDID);
        const validators = pBlocks.map((pBlock) => ({ DID: pBlock.validatorDID, URL: "validator-URL" }));
        const allValidators = [...validators];

        // make the second validator unreachable and remove it's pBlock
        const unreachableValidator = validators[1];
        pBlocks.splice(1, 1);
        validators.splice(1, 1);

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
                            validators: allValidators,
                        });
                    },
                },
            },
            executePBlock: async (pBlock) => {
                executedPBlocksCount++;
            },
        };

        const broadcasterMock = {
            broadcastValidatorNonInclusion: () => {},
        };

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

        const pendingBlocksTimeoutMs = 1000 * 3; // 3 seconds
        const nonInclusionCheckTimeoutMs = 1000 * 3; // 3 seconds
        const consensusCore = ConsensusCore.create(
            validator,
            null,
            domain,
            rootFolder,
            brickStorageMock,
            executionEngineMock,
            broadcasterMock,
            notifierMock,
            pendingBlocksTimeoutMs,
            nonInclusionCheckTimeoutMs,
            validatorContractExecutorFactoryMock
        );
        await consensusCore.boot();

        // firstly add only the first block
        const firstPBlock = pBlocks[0];
        consensusCore.addInConsensusAsync(firstPBlock);

        // wait until the pendingBlocksTimeout has been reached
        await sleep(pendingBlocksTimeoutMs);
        await sleep(pendingBlocksTimeoutMs);

        try {
            await consensusCore.setValidatorNonInclusionAsync({
                validatorDID: validators[0].DID,
                blockNumber: firstPBlock.blockNumber,
                unreachableValidators: [unreachableValidator],
            });
            assert.true(
                false,
                "Should no be able to accept non inclusion messages since the pending block is still in PENDING_BLOCKS, extended due to a lot of missing pBlocks"
            );
        } catch (error) {
            assert.notNull(error);
        }

        try {
            await consensusCore.addInConsensusAsync(firstPBlock);
            assert.true(false, "Should no be able to receive pBlock from a validator that is already received");
        } catch (error) {
            assert.notNull(error);
        }

        // simulate that all the remaining validators are sending their blocks for validation
        for (let index = 1; index < pBlocks.length; index++) {
            const pBlock = pBlocks[index];
            consensusCore.addInConsensusAsync(pBlock);
            await sleep(100); // simulate that the pBlock won't arrive instantly
        }

        await sleep(4000); // wait for pending block timeout to occur in order to enter non inclusion phase

        // simulate that all remaining validators will send a non inclusion message containing only the missing validator
        for (let index = 0; index < validators.length; index++) {
            const validator = validators[index];

            try {
                await consensusCore.setValidatorNonInclusionAsync({
                    validatorDID: validator.DID,
                    blockNumber: pBlocks[0].blockNumber,
                    unreachableValidators: [unreachableValidator],
                });
            } catch (error) {
                // the method will throw at some point when the non inclusion majority is reached
            }
            await sleep(100); // simulate that the message won't arrive instantly
        }

        await sleep(5000); // wait for block finalization phase to occur

        assert.equal(
            pBlocks.length - 1, // the validator's own pBlock won't be executed again since it was executed when commands were being executed
            executedPBlocksCount,
            `Expected executor to execute ${pBlocks.length} pBlocks, but only executed ${executedPBlocksCount}`
        );

        const expectedValidatedBlockCount = 2;
        await assertBlockFileEntries(rootFolder, consensusCore, expectedValidatedBlockCount);

        testFinished();
    },
    20000
);
