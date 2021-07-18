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
    "Run consensus core addInConsensusAsync for multiple validators and single block with multiple random pBlock, but with multiple validators (different for current validator) becoming unreachable for all other validators",
    async (testFinished) => {
        const rootFolder = await createTestFolder();
        await writeHashesToValidatedBlocksFile(rootFolder, domain, ["latestBlockHash"]);

        const pBlocks = await Promise.all(
            Array.from(Array(getRandomInt(7, 8)).keys()).map((index) => generatePBlockWithSingleCommand(index))
        );

        console.log(`Constructed ${pBlocks.length} pBlocks`);

        const validator = await parseValidatorDID(pBlocks[0].validatorDID);
        const validators = pBlocks.map((pBlock) => ({ DID: pBlock.validatorDID, URL: "validator-URL" }));
        const allValidators = [...validators];

        // make the second validator unreachable and remove it's pBlock
        const majorityUnreachableValidator = validators[1];
        const extraMissingValidator = validators[2];
        const extraMissingPBlock = pBlocks[2];
        pBlocks.splice(1, 2);
        validators.splice(1, 2);

        const brickStorageMock = {
            addBrickAsync: async (block) => {
                // consider pBlockHashLinkSSI to be the hash for simplicity
                return block.hash;
            },
        };

        let executedPBlocksCount = 0;
        let wasGetPBlockProposedByValidatorAsyncCalledCorrectly = false;

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

        const validatorContractExecutorFactoryMock = {
            create: () => {
                return {
                    getValidatorsAsync: async () => allValidators,
                    getLatestBlockInfoAsync: async () => ({ number: 1, hash: "latestBlockHash" }),
                    getPBlockProposedByValidatorAsync: async (blockNumber, validatorDID) => {
                        if (wasGetPBlockProposedByValidatorAsyncCalledCorrectly) {
                            throw new Error("getPBlockProposedByValidatorAsync already called before");
                        }
                        wasGetPBlockProposedByValidatorAsyncCalledCorrectly = true;
                        assert.equal(
                            blockNumber,
                            pBlocks[0].blockNumber,
                            `Expected to query for block number ${pBlocks[0].blockNumber} but intead queried for ${blockNumber}`
                        );
                        assert.equal(
                            validatorDID,
                            extraMissingValidator.DID,
                            `Expected to query missing pBlock for validator '${extraMissingValidator.DID}' but queried 'validatorDID' instead`
                        );

                        return extraMissingPBlock;
                    },
                };
            },
        };

        const pendingBlocksTimeoutMs = 1000 * 3; // 3 seconds
        const nonInclusionCheckTimeoutMs = 1000 * 8; // 3 seconds
        const consensusCore = ConsensusCore.create(
            validator,
            null,
            domain,
            rootFolder,
            brickStorageMock,
            executionEngineMock,
            broadcasterMock,
            pendingBlocksTimeoutMs,
            nonInclusionCheckTimeoutMs,
            validatorContractExecutorFactoryMock
        );
        await consensusCore.boot();

        // simulate that all the remaining validators are sending their blocks for validation
        for (let index = 0; index < pBlocks.length; index++) {
            const pBlock = pBlocks[index];
            consensusCore.addInConsensusAsync(pBlock);
            await sleep(100); // simulate that the pBlock won't arrive instantly
        }

        await sleep(4000); // wait for pending block timeout to occur in order to enter non inclusion phase

        // simulate that all remaining validators will send a non inclusion message containing only the majority missing validator
        for (let index = 0; index < validators.length; index++) {
            const validator = validators[index];

            try {
                await consensusCore.setValidatorNonInclusionAsync({
                    validatorDID: validator.DID,
                    blockNumber: pBlocks[0].blockNumber,
                    unreachableValidators: [majorityUnreachableValidator],
                });
            } catch (error) {
                // the method will throw at some point when the non inclusion majority is reached
            }
            await sleep(100); // simulate that the message won't arrive instantly
        }

        await sleep(4000); // wait for block finalization phase to occur

        assert.true(
            wasGetPBlockProposedByValidatorAsyncCalledCorrectly,
            "Expected getPBlockProposedByValidatorAsync to be called once"
        );

        assert.equal(
            pBlocks.length, // +1 because the missing pBlock has been loaded and -1 because the validator's own pBlock won't be executed again since it was executed when commands were being executed
            executedPBlocksCount,
            `Expected executor to execute ${pBlocks.length} pBlocks, but only executed ${executedPBlocksCount}`
        );

        const expectedValidatedBlockCount = 2;
        await assertBlockFileEntries(rootFolder, consensusCore, expectedValidatedBlockCount);

        testFinished();
    },
    20000
);
