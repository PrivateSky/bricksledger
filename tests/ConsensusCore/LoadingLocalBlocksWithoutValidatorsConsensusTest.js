require("../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const ConsensusCore = require("../../src/ConsensusCore");
const {
    createTestFolder,
    getRandomInt,
    generatePBlockWithSingleCommand,
    parseValidatorDID,
    writeHashesToValidatedBlocksFile,
    getHashLinkSSIString,
} = require("../utils");

assert.callback(
    "Booting the consensus with a single self validator present with random block already executed",
    async (testFinished) => {
        const domain = "contract";

        const rootFolder = await createTestFolder();

        const pBlock = await generatePBlockWithSingleCommand();
        const validator = await parseValidatorDID(pBlock.validatorDID);

        const brickStorageMock = {};

        const executionEngineMock = {
            contracts: {
                bdns: {
                    getDomainInfo: (callback) => {
                        callback(null, {
                            validators: [{ DID: validator.getIdentifier(), URL: "validator-URL" }],
                        });
                    },
                },
            },
        };

        const notifierMock = {
            notifyNewBlock: (blockInfo) => {
                console.log("Notifying new block", blockInfo);
            },
        };

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
            notifierMock,
            null,
            null,
            validatorContractExecutorFactoryMock
        );

        let latestBlockInfo = consensusCore.getLatestBlockInfo();
        assert.equal(latestBlockInfo.number, 0);
        assert.isNull(latestBlockInfo.hash);

        const blockHashes = Array.from(Array(getRandomInt(100, 200)).keys()).map((index) =>
            getHashLinkSSIString(domain, `block-hash-${index}`)
        );
        await writeHashesToValidatedBlocksFile(rootFolder, domain, blockHashes);

        await consensusCore.boot();

        latestBlockInfo = consensusCore.getLatestBlockInfo();
        assert.equal(
            latestBlockInfo.number,
            blockHashes.length,
            `Expected to have ${blockHashes.length} blocks loaded, but received only ${latestBlockInfo.number}`
        );
        assert.equal(latestBlockInfo.hash, blockHashes[blockHashes.length - 1]);

        testFinished();
    },
    10000
);
