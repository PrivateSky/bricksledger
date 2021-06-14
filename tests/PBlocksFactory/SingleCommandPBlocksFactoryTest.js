require("../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const Command = require("../../src/Command");
const PBlocksFactory = require("../../src/PBlocksFactory");

async function createPBlockFactoryWithSingleCommandInConsensus(maxBlockSize, maxBlockTimeMs, testFinished) {
    const domain = "contract";

    const latestBlockHash = "latestBlockHash";
    const latestBlockNumber = 1;

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

    const brickStorageMock = {
        addBrickAsync: async (pBlock) => {
            return "pblock-hash";
        },
    };

    const consensusCoreMock = {
        getLatestBlockInfo: () => ({
            number: latestBlockNumber,
            hash: latestBlockHash,
        }),
        addInConsensusAsync: async (pBlock, pBlockHashLink) => {
            assert.notNull(pBlock);
            assert.notNull(pBlockHashLink);
            assert.equal(pBlock.validatorDID, validatorDID.getIdentifier());
            assert.true(
                pBlock.commands && Array.isArray(pBlock.commands) && pBlock.commands.length === 1,
                "pBlock should have one and only one command"
            );
            assert.equal(pBlock.previousBlockHash, latestBlockHash);
            assert.equal(pBlock.blockNumber, latestBlockNumber + 1);

            const isValidSignature = await $$.promisify(validatorDID.verify)(pBlock.hash, pBlock.validatorSignature);
            assert.true(isValidSignature, "Signature is not valid for pBlock");

            testFinished();
        },
    };

    const pBlocksFactory = PBlocksFactory.create(
        domain,
        validatorDID,
        brickStorageMock,
        consensusCoreMock,
        maxBlockSize,
        maxBlockTimeMs
    );
    pBlocksFactory.addCommandForConsensus(command);
}

assert.callback(
    "Create PBlocksFactory block with single command size restriction",
    async (testFinished) => {
        // pBlock factory with 1 command per block and default time restriction
        createPBlockFactoryWithSingleCommandInConsensus(1, null, testFinished);
    },
    10000
);

assert.callback(
    "Create PBlocksFactory block with single command time restriction",
    async (testFinished) => {
        // pBlock factory with 100 commands per block or 5 seconds time restriction
        createPBlockFactoryWithSingleCommandInConsensus(100, 1000 * 5, testFinished);
    },
    10000
);
