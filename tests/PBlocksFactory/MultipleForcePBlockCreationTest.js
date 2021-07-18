require("../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const Command = require("../../src/Command");
const PBlocksFactory = require("../../src/PBlocksFactory");
const { sleep, getRandomInt } = require("../utils");

assert.callback(
    "Create PBlocksFactory and call forcePBlockCreationForBlockNumberIfAbsentAsync multiple times to create a single empty pBlock only",
    async (testFinished) => {
        const domain = "contract";
        const maxBlockSize = 1;
        const maxBlockTimeMs = 1000;

        const latestBlockHash = "latestBlockHash";
        const latestBlockNumber = 1;

        const w3cDID = require("opendsu").loadApi("w3cdid");
        const validatorDID = await $$.promisify(w3cDID.createIdentity)("demo", "id");

        const brickStorageMock = {
            addBrickAsync: async (pBlock) => {
                return "pblock-hash";
            },
        };

        let isAddInConsensusAsyncCalled = false;
        const consensusCoreMock = {
            isRunning: () => true,
            getLatestBlockInfo: () => ({
                number: latestBlockNumber,
                hash: latestBlockHash,
            }),

            addInConsensusAsync: async (pBlock) => {
                if (isAddInConsensusAsyncCalled) {
                    assert.true(false, "Expected addInConsensusAsync to be called one time only");
                } else {
                    isAddInConsensusAsyncCalled = true;
                }

                assert.true(pBlock.isEmpty, "Expected pBlock to be empty since no commands were added");
            },
        };

        const broadcasterMock = {
            broadcastPBlockAdded: () => {},
        };

        const pBlocksFactory = PBlocksFactory.create(
            domain,
            validatorDID,
            brickStorageMock,
            consensusCoreMock,
            broadcasterMock,
            maxBlockSize,
            maxBlockTimeMs
        );

        Array.from(Array(getRandomInt(100, 200))).forEach(() => {
            pBlocksFactory.forcePBlockCreationForBlockNumberIfAbsentAsync(latestBlockNumber + 1);
        });

        await sleep(1000);

        assert.true(isAddInConsensusAsyncCalled, "Expected addInConsensusAsync to be called one time only");
        testFinished();
    },
    10000
);
