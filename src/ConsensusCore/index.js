/*
A configurable consensus core that can have 3 consensus strategies
 - SVBC - Single Validator BrickLedger Consensus:  Only one node is accepting commands and propose BrickBlocks. A block has only one BrickBlock.
 - MVBC - Multiple Validators BrickLedger Consensus: run the BrickLedger consensus between validators
 - OBAC - Other Blockchain Adapter Consensus: Delegates Consensus to a blockchain adapter that is using other blockchain network for consensus regrading the blocks of commands 
*/

const PBlock = require("../PBlock");
const { getValidatorsForCurrentDomain } = require("../utils/bdns-utils");
const { clone } = require("../utils/object-utils");
const { getValidatedBlocksWriteStream, createNewBlock, saveBlockInBricks, appendValidatedBlockHash } = require("./utils");

class ConsensusCore {
    constructor(domain, rootFolder, maxBlockTimeMs, brickStorage, executionEngine) {
        this.domain = domain;
        this.rootFolder = rootFolder;
        if (!maxBlockTimeMs) {
            maxBlockTimeMs = 1000 * 60; // 1 minute
        }
        this.maxBlockTimeMs = maxBlockTimeMs;

        this.brickStorage = brickStorage;
        this.executionEngine = executionEngine;

        this._latestBlockNumber = 0;
        this._latestBlockHash = null;

        this._pendingBlocksByBlockNumber = {};
    }

    async init() {
        const { domain, rootFolder, executionEngine } = this;

        const validators = await getValidatorsForCurrentDomain(executionEngine);
        if (!validators || !validators.length) {
            throw new Error(`No validators found for domain '${domain}'`);
        }
        if (validators.length === 2) {
            throw new Error(`Consensus cannot be used for 2 validators`);
        }
        this.validators = validators;
        this.validatedBlocksWriteStream = await getValidatedBlocksWriteStream(rootFolder, domain);
    }

    addInConsensus(pBlock, callback) {
        callback = $$.makeSaneCallback(callback);

        this.addInConsensusAsync(pBlock)
            .then((result) => callback(undefined, result))
            .catch((error) => callback(error));
    }

    async addInConsensusAsync(pBlock) {
        await this.validatePBlockAsync(pBlock);

        const { blockNumber } = pBlock;

        let pendingBlock = this._pendingBlocksByBlockNumber[blockNumber];
        if (pendingBlock && pendingBlock.isConsensusRunning) {
            throw new Error(
                `Consensus is currently running for block number ${blockNumber}. PBlock ${pBlock.hashLinkSSI} rejected.`
            );
        }
        const validators = clone(this.validators);
        if (!pendingBlock) {
            const blockTimeout = setTimeout(() => {
                // the block timeout has occured after the consensus has been started, so we ignore the timeout
                if (pendingBlock.isConsensusRunning) {
                    return;
                }

                const { validators, pendingPBlocks } = pendingBlock;
                pendingBlock.isConsensusRunning = true;
                console.log(
                    `[Consensus] Consensus timeout for pBlock ${blockNumber} has been reached. Received only ${pendingPBlocks.length} pBlocks out of ${validators.length} validators`
                );
                this._startConsensusForPendingBlock(pendingBlock);
            }, this.maxBlockTimeMs);

            pendingBlock = {
                blockNumber,
                startTime: Date.now(),
                pendingPBlocks: [],
                blockTimeout,
                validators,
            };
            this._pendingBlocksByBlockNumber[blockNumber] = pendingBlock;
        }

        const { pendingPBlocks } = pendingBlock;

        return new Promise(async (resolve, reject) => {
            pendingPBlocks.push({
                pBlock,
                callback: (error, result) => {
                    if (error) {
                        return reject(error);
                    }
                    resolve(result);
                },
            });

            const canStartConsensus = validators.length === pendingPBlocks.length;
            if (canStartConsensus) {
                pendingBlock.isConsensusRunning = true;
                clearTimeout(pendingBlock.blockTimeout);

                this._startConsensusForPendingBlock(pendingBlock);
            } else {
                console.log(
                    `[Consensus] Consensus for pBlock ${blockNumber} has received ${pendingPBlocks.length} pBlock(s) from a total of ${validators.length} validators`
                );
            }
        });
    }

    validatePBlock(pBlock, callback) {
        callback = $$.makeSaneCallback(callback);

        this.validatePBlockAsync(pBlock)
            .then((result) => callback(undefined, result))
            .catch((error) => callback(error));
    }

    async validatePBlockAsync(pBlock) {
        pBlock = new PBlock(pBlock);

        const { blockNumber } = pBlock;

        if (blockNumber <= this._latestBlockNumber) {
            throw new Error(
                `pBlock has block number ${blockNumber} less than or equal to the  latest block number ${this._latestBlockNumber}`
            );
        }

        await pBlock.validateSignature();

        // TODO: check if validatorDID is valid for participating into consensus
    }

    getLatestBlockInfo() {
        return {
            number: this._latestBlockNumber,
            hash: this._latestBlockHash,
        };
    }

    async _startConsensusForPendingBlock(pendingBlock) {
        console.log(`[Consensus] Starting consensus for pBlock ${pendingBlock.blockNumber}...`);
        setTimeout(async () => {
            try {
                // consensus finished with success, so generate block and broadcast it
                const block = createNewBlock(pendingBlock, this._latestBlockHash);
                console.log(`[Consensus] Created block for block number ${pendingBlock.blockNumber}...`, block);
                const blockHashLinkSSI = await saveBlockInBricks(block, this.domain, this.brickStorage);
                block.hashLinkSSI = blockHashLinkSSI;

                this._latestBlockHash = blockHashLinkSSI.getIdentifier();
                this._latestBlockNumber = block.blockNumber;

                await appendValidatedBlockHash(this._latestBlockHash, this.validatedBlocksWriteStream);

                // execute each pBlock and then call the block info callback in order for pBlocksFactory to know to continue pBlocks creations
                const { pendingPBlocks } = pendingBlock;
                for (let index = 0; index < pendingPBlocks.length; index++) {
                    const { pBlock, callback } = pendingPBlocks[index];
                    const saneCallback = $$.makeSaneCallback(callback);

                    try {
                        await this.executionEngine.executePBlock(pBlock);
                        saneCallback();
                    } catch (error) {
                        saneCallback(error);
                    }
                }
            } catch (error) {
                console.error("Error while executing pBlock", error);
                throw error;
            }
        }, 1000);
    }
}

function create(...params) {
    return new ConsensusCore(...params);
}

module.exports = {
    create,
};
