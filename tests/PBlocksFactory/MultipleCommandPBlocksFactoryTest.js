require("../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const Command = require("../../src/Command");
const PBlocksFactory = require("../../src/PBlocksFactory");

assert.callback(
    "Create PBlocksFactory block with multiple commands size restriction",
    async (testFinished) => {
        const domain = "contract";

        const maxBlockSize = 10;
        const maxBlockTimeMs = 1000 * 60;

        const latestBlockHash = "latestBlockHash";
        const latestBlockNumber = 1;

        const w3cDID = require("opendsu").loadApi("w3cdid");
        const validatorDID = await $$.promisify(w3cDID.createIdentity)("demo", "id");

        const commandsCount = 100;
        const expectedPBlocksCount = commandsCount / maxBlockSize;
        const commands = Array.from(Array(commandsCount).keys()).map(
            (idx) =>
                new Command({
                    domain,
                    contractName: "test",
                    methodName: "nonced",
                    params: [idx],
                    type: "nonced",
                    timestamp: Date.now(),
                    signerDID: validatorDID.getIdentifier(),
                })
        );

        let pBlocksForwardedForConsensus = [];

        const brickStorageMock = {
            addBrickAsync: async (pBlock) => {
                return "pblock-hash";
            },
        };

        const consensusCoreMock = {
            isRunning: () => true,
            getLatestBlockInfo: () => {
                if (!pBlocksForwardedForConsensus.length) {
                    return {
                        number: latestBlockNumber,
                        hash: latestBlockHash,
                    };
                }

                const latestBlock = pBlocksForwardedForConsensus[pBlocksForwardedForConsensus.length - 1];
                return {
                    number: latestBlock.blockNumber,
                    hash: latestBlock.hash,
                };
            },
            addInConsensusAsync: async (pBlock) => {
                assert.notNull(pBlock);

                pBlocksForwardedForConsensus.push(pBlock);

                if (pBlocksForwardedForConsensus.length === expectedPBlocksCount) {
                    pBlocksForwardedForConsensus.forEach((pBlock, idx) => {
                        const previousPBlock =
                            idx !== 0
                                ? pBlocksForwardedForConsensus[idx - 1]
                                : {
                                      blockNumber: latestBlockNumber,
                                      hash: latestBlockHash,
                                  };

                        assert.equal(pBlock.blockNumber, previousPBlock.blockNumber + 1);
                        assert.equal(pBlock.previousBlockHash, previousPBlock.hash);
                    });

                    testFinished();
                }
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

        commands.forEach((command) => pBlocksFactory.addCommandForConsensusAsync(command));
    },
    10000
);
