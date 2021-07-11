require("../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const ConsensusCore = require("../../src/ConsensusCore");
const { createTestFolder } = require("../integration/utils");
const { sleep } = require("../utils");
const {
    generatePBlockWithSingleCommand,
    assertBlockFileEntries,
    parseValidatorDID,
    writeHashesToValidatedBlocksFile,
} = require("./utils");

assert.callback(
    "Run consensus core addInConsensusAsync for a single validator and single block with a single pBlock",
    async (testFinished) => {
        const domain = "contract";

        const rootFolder = await createTestFolder();
        await writeHashesToValidatedBlocksFile(rootFolder, domain, ["latestBlockHash"]);

        const pBlock = await generatePBlockWithSingleCommand();
        const validator = await parseValidatorDID(pBlock.validatorDID);
        const allValidators = [{ DID: validator.getIdentifier(), URL: "validator-URL" }];

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
                            validators: allValidators,
                        });
                    },
                },
            },
            executePBlock: async (pBlock) => {
                console.log("Executing pBlock...");
            },
        };

        const broadcasterMock = {};

        const validatorContractExecutorFactoryMock = {
            create: () => {
                return {
                    getValidatorsAsync: async () => allValidators,
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
            null,
            null,
            validatorContractExecutorFactoryMock
        );
        await consensusCore.boot();

        await consensusCore.addInConsensusAsync(pBlock);

        await sleep(1000); // wait for blocks file to be updated since it's written after consensus is reached and addInConsensusAsync returns
        const expectedValidatedBlockCount = 2;
        await assertBlockFileEntries(rootFolder, consensusCore, expectedValidatedBlockCount);

        testFinished();
    },
    10000
);
