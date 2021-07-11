require("../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const ConsensusCore = require("../../src/ConsensusCore");
const { createTestFolder } = require("../integration/utils");
const { getRandomInt } = require("../utils");
const { createValidatorDID, writeHashesToValidatedBlocksFile, getHashLinkSSIString, areHashLinkSSIEqual } = require("./utils");

const domain = "contract";

async function bootConsensusWithMultipleValidators(blockHashes) {
    const rootFolder = await createTestFolder();

    const w3cDID = require("opendsu").loadApi("w3cdid");
    const validator = await $$.promisify(w3cDID.createIdentity)("demo", "id"); // the new validator which has missing blocks
    const validator2 = await createValidatorDID(1);
    const validator3 = await createValidatorDID(2);

    const allValidators = [
        { DID: validator.getIdentifier(), URL: "validator-URL" },
        { DID: validator2.getIdentifier(), URL: "validator-URL-2" },
        { DID: validator3.getIdentifier(), URL: "validator-URL-3" },
    ];
    // constructing the validators that will be visible to the other existing validators
    const allValidatorsExceptFirst = allValidators.slice(1);

    await writeHashesToValidatedBlocksFile(rootFolder, domain, blockHashes);

    const missingHashCount = getRandomInt(10, 20);
    const missingBlockHashes = Array.from(Array(missingHashCount).keys()).map((index) =>
        getHashLinkSSIString(domain, `block-hash-${blockHashes.length + index}`)
    );
    const completeBlockHashes = [...blockHashes, ...missingBlockHashes];
    console.log("completeBlockHashes", completeBlockHashes);

    const brickStorageMock = {
        addBrickAsync: async (blockSerialisation) => {
            // returning a simple deterministic hash for test purpose
            const { blockNumber } = JSON.parse(blockSerialisation);
            return `block-hash-${blockNumber - 1}`;
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
            console.log("Executing pBlocK", pBlock);
        },
    };

    const broadcasterMock = {
        broadcastValidatorNonInclusion: () => {},
    };

    let validatorInquirerGetLatestBlockInfoCalled = false;
    let validatorInquirerProposeAsValidatorCalled = false;

    const validatorContractExecutorFactoryMock = {
        create: () => {
            return {
                getValidatorsAsync: async () => allValidators,
                getLatestBlockInfoAsync: async () => {
                    validatorInquirerGetLatestBlockInfoCalled = true;
                    return {
                        number: completeBlockHashes.length,
                        hash: completeBlockHashes[completeBlockHashes.length - 1],
                    };
                },
                getBlockAsync: async (blockHash) => {
                    const blockHashIndex = completeBlockHashes.findIndex((hash) => areHashLinkSSIEqual(hash, blockHash));
                    const block = {
                        pbs: [`pBlock-hash-${blockHashIndex}`],
                        blockNumber: blockHashIndex + 1,
                        previousBlock: completeBlockHashes[blockHashIndex - 1],
                        hashLinkSSI: completeBlockHashes[blockHashIndex],
                    };

                    console.log(`Respondig with block for hash ${blockHash}`, block);
                    return block;
                },
                getPBlockAsync: async (pBlockHash) => {
                    const pBlock = {
                        hashLinkSSI: pBlockHash,
                    };
                    console.log(`Respondig with block for hash ${pBlockHash}`, pBlock);
                    return pBlock;
                },
                proposeValidatorAsync: async (proposedValidator) => {
                    validatorInquirerProposeAsValidatorCalled = true;
                    console.log("proposedValidator", proposedValidator);
                    assert.equal(proposedValidator.DID, validator.getIdentifier());
                },
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

    let latestBlockInfo = consensusCore.getLatestBlockInfo();
    assert.equal(latestBlockInfo.number, 0);
    assert.isNull(latestBlockInfo.hash);

    await consensusCore.boot();

    const openDSU = require("opendsu");
    const keySSISpace = openDSU.loadApi("keyssi");

    latestBlockInfo = consensusCore.getLatestBlockInfo();
    console.log("latestBlockInfo", latestBlockInfo, keySSISpace.parse(latestBlockInfo.hash).getIdentifier(true));

    const expectedLatestBlockHash = completeBlockHashes[completeBlockHashes.length - 1];
    assert.equal(
        latestBlockInfo.number,
        completeBlockHashes.length,
        `Expected to have ${completeBlockHashes.length} blocks loaded, but received only ${latestBlockInfo.number}`
    );
    assert.true(
        areHashLinkSSIEqual(latestBlockInfo.hash, expectedLatestBlockHash),
        `Expected to have ${expectedLatestBlockHash} as latest block hash, but received ${latestBlockInfo.hash}`
    );

    assert.true(
        validatorInquirerGetLatestBlockInfoCalled,
        "Expected validatorContractExecutor.getLatestBlockInfoAsync to be called"
    );
    assert.false(
        validatorInquirerProposeAsValidatorCalled,
        "Expected validatorContractExecutor.proposeValidatorAsync to not be called because crrent validator is already part of the validator's list"
    );
}

assert.callback(
    "Booting the consensus with a validator having no blocks already executed, and checking other validators for random missing blocks",
    async (testFinished) => {
        const existingLocalBlockHashes = [];
        await bootConsensusWithMultipleValidators(existingLocalBlockHashes);

        testFinished();
    },
    10000
);

// assert.callback(
//     "Booting the consensus with a validator having random block already executed, and checking other validators for random missing blocks",
//     async (testFinished) => {
//         const existingLocalBlockHashes = Array.from(Array(getRandomInt(10, 20)).keys()).map((index) =>
//             getHashLinkSSIString(domain, `block-hash-${index}`)
//         );
//         await bootConsensusWithMultipleValidators(existingLocalBlockHashes);

//         testFinished();
//     },
//     10000
// );
