/*
A configurable consensus core that can have 3 consensus strategies
 - SVBC - Single Validator BrickLedger Consensus:  Only one node is accepting commands and propose BrickBlocks. A block has only one BrickBlock.
 - MVBC - Multiple Validators BrickLedger Consensus: run the BrickLedger consensus between validators
 - OBAC - Other Blockchain Adapter Consensus: Delegates Consensus to a blockchain adapter that is using other blockchain network for consensus regrading the blocks of commands 
*/

const PBlock = require("../PBlock");
const Logger = require("../Logger");
const { clone } = require("../utils/object-utils");
const {
    getLocalLatestBlockInfo,
    getValidatedBlocksWriteStream,
    createNewBlock,
    saveBlockInBricks,
    appendValidatedBlockHash,
    loadValidatorsFromBdns,
    sortPBlocks,
} = require("./utils");
const Block = require("../Block");
const ValidatorSynchronizer = require("./ValidatorSynchronizer");

class ConsensusCore {
    constructor(
        validatorDID,
        validatorURL,
        domain,
        rootFolder,
        maxBlockTimeMs,
        brickStorage,
        executionEngine,
        validatorContractExecutorFactory
    ) {
        this._validatorDID = validatorDID;
        this._validatorURL = validatorURL;
        this._domain = domain;
        this._rootFolder = rootFolder;
        if (!maxBlockTimeMs) {
            maxBlockTimeMs = 1000 * 60; // 1 minute
        }
        this._maxBlockTimeMs = maxBlockTimeMs;

        this._brickStorage = brickStorage;
        this._executionEngine = executionEngine;
        this._validatorContractExecutorFactory =
            validatorContractExecutorFactory || require("./ValidatorContractExecutorFactory");

        this._latestBlockNumber = 0;
        this._latestBlockHash = null;

        this._pendingBlocksByBlockNumber = {};

        this._isRunning = false;

        this._logger = new Logger(`[Bricksledger][${this._domain}][${this._validatorDID.getIdentifier()}][Consensus]`);
        this._logger.info("Create finished");
    }

    async boot() {
        this._logger.info(`Booting consensus...`);

        await this._loadValidators();

        this._logger.info(`Checking local blocks history...`);
        const latestBlockInfo = await getLocalLatestBlockInfo(this._rootFolder, this._domain);
        const { number, hash } = latestBlockInfo;
        this._latestBlockNumber = number;
        this._latestBlockHash = hash;
        this._logger.info(`Found ${number} local block(s), with the latest block hash being ${hash}...`);

        // this.validatedBlocksWriteStream = await getValidatedBlocksWriteStream(this._rootFolder, this._domain);

        const validatorsExceptSelf = this.validators.filter((validator) => validator.DID !== this._validatorDID.getIdentifier());
        this._logger.info(`Found ${validatorsExceptSelf.length} external validators`);
        if (validatorsExceptSelf.length) {
            const validator = validatorsExceptSelf[0];

            return new Promise(async (resolve) => {
                const onSyncFinished = () => {
                    // the synchronization process is finished (all blocks are up to date and validator is recognized as a validator)
                    this._isRunning = true;
                    resolve();
                };
                const validatorSynchronizer = new ValidatorSynchronizer(
                    this._domain,
                    this._validatorDID,
                    this._validatorURL,
                    validator,
                    this._rootFolder,
                    this.getLatestBlockInfo.bind(this),
                    loadValidatorsFromBdns.bind(null, this._domain, this._executionEngine),
                    this._validatorContractExecutorFactory,
                    this._executeBlock.bind(this),
                    onSyncFinished
                );
                await validatorSynchronizer.synchronize();
            });
        } else {
            // no external validators were found except self, so we will be running consensus with a single validator
            this._isRunning = true;
        }
    }

    isRunning() {
        return this._isRunning;
    }

    getLatestBlockInfo() {
        return {
            number: this._latestBlockNumber,
            hash: this._latestBlockHash,
        };
    }

    addInConsensus(pBlock, callback) {
        callback = $$.makeSaneCallback(callback);

        this.addInConsensusAsync(pBlock)
            .then((result) => callback(undefined, result))
            .catch((error) => callback(error));
    }

    async addInConsensusAsync(pBlock) {
        if (!this._isRunning) {
            throw new Error("Consensus not yet running");
        }

        if (!(pBlock instanceof PBlock)) {
            throw new Error("pBlock not instance of PBlock");
        }

        await this.validatePBlockAsync(pBlock);

        const { blockNumber } = pBlock;

        let pendingBlock = this._pendingBlocksByBlockNumber[blockNumber];
        if (pendingBlock) {
            if (pendingBlock.isConsensusRunning) {
                throw new Error(
                    `Consensus is currently running for block number ${blockNumber}. PBlock ${pBlock.hashLinkSSI} rejected.`
                );
            }
        } else {
            await this._startConsensusForBlockNumber(blockNumber);
            pendingBlock = this._pendingBlocksByBlockNumber[blockNumber];
        }

        const { pBlocks, validators } = pendingBlock;

        // return a promise when the final consensus is reached
        return new Promise(async (resolve, reject) => {
            pBlock.onConsensusFinished = (error, result) => {
                if (error) {
                    return reject(error);
                }
                resolve(result);
            };

            pBlocks.push(pBlock);

            const canStartConsensus = validators.length === pBlocks.length;
            if (canStartConsensus) {
                pendingBlock.isConsensusRunning = true;
                clearTimeout(pendingBlock.blockTimeout);

                this._startConsensusForPendingBlock(pendingBlock);
            } else {
                this._logger.info(
                    `Consensus for pBlock ${blockNumber} has received ${pBlocks.length} pBlock(s) from a total of ${validators.length} validators`
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
        if (!this._isRunning) {
            throw new Error("Consensus not yet running");
        }

        if (!(pBlock instanceof PBlock)) {
            throw new Error("pBlock not instance of PBlock");
        }

        const { blockNumber, validatorDID } = pBlock;

        if (blockNumber <= this._latestBlockNumber) {
            throw new Error(
                `pBlock has block number ${blockNumber} less than or equal to the  latest block number ${this._latestBlockNumber}`
            );
        }

        await pBlock.validateSignature();
        const isValidatorRecognized = this.validators.some((validator) => validator.DID === validatorDID);
        if (!isValidatorRecognized) {
            throw new Error(`Pblock '${pBlock.hashLinkSSI}' has a nonrecognized validator '${validatorDID}'`);
        }
    }

    async _startConsensusForBlockNumber(blockNumber) {
        const blockTimeout = setTimeout(() => {
            const pendingBlock = this._pendingBlocksByBlockNumber[blockNumber];
            // the block timeout has occured after the consensus has been started, so we ignore the timeout
            if (pendingBlock.isConsensusRunning) {
                return;
            }

            const { validators, pBlocks } = pendingBlock;
            pendingBlock.isConsensusRunning = true;
            this._logger.info(
                `Consensus timeout for pBlock ${blockNumber} has been reached. Received only ${pBlocks.length} pBlocks out of ${validators.length} validators`
            );
            this._startConsensusForPendingBlock(pendingBlock);
        }, this._maxBlockTimeMs);

        const pendingBlock = {
            blockNumber,
            startTime: Date.now(),
            pBlocks: [],
            blockTimeout,
        };
        this._pendingBlocksByBlockNumber[blockNumber] = pendingBlock;

        // add validators after setting pendingBlock in order to avoid race condition issues
        await this._loadValidators();
        pendingBlock.validators = clone(this.validators);
    }

    async _startConsensusForPendingBlock(pendingBlock) {
        this._logger.info(`Starting consensus for pBlock ${pendingBlock.blockNumber}...`);
        setTimeout(async () => {
            try {
                // consensus finished with success, so generate block and broadcast it
                const block = createNewBlock(pendingBlock, this._latestBlockHash);
                this._logger.info(`Created block for block number ${pendingBlock.blockNumber}...`, block);
                this._executeBlock(block, pendingBlock.pBlocks);
            } catch (error) {
                console.error("Error while executing pBlock", error);
                throw error;
            }
        }, 1000);
    }

    async _executeBlock(block, pBlocks) {
        await this._storeBlock(block);
        await this._executePBlocks(pBlocks);
        await this._updateLatestBlockInfo(block);
    }

    async _storeBlock(block) {
        this._logger.info("Storing block", block);
        const blockHashLinkSSI = await saveBlockInBricks(block, this._domain, this._brickStorage);
        block.hashLinkSSI = blockHashLinkSSI.getIdentifier();
    }

    async _executePBlocks(pBlocks) {
        sortPBlocks(pBlocks);

        for (let index = 0; index < pBlocks.length; index++) {
            const pBlock = pBlocks[index];
            const callback =
                typeof pBlock.onConsensusFinished === "function" ? $$.makeSaneCallback(pBlock.onConsensusFinished) : () => {};

            try {
                await this._executionEngine.executePBlock(pBlock);

                callback();
            } catch (error) {
                this._logger.error("Failed to execute pBlock", pBlock);
                callback(error);
                throw error;
            }
        }
    }

    async _updateLatestBlockInfo(block) {
        this._logger.info(`Updating latest block number to ${block.blockNumber} and latest block hash to ${block.hashLinkSSI}`);
        this._latestBlockNumber = block.blockNumber;
        this._latestBlockHash = block.hashLinkSSI;

        const validatedBlocksWriteStream = await getValidatedBlocksWriteStream(this._rootFolder, this._domain);
        await appendValidatedBlockHash(this._latestBlockHash, validatedBlocksWriteStream);
        validatedBlocksWriteStream.close();
    }

    async _loadValidators() {
        this._logger.info(`Loading validators...`);
        this.validators = await loadValidatorsFromBdns(this._domain, this._executionEngine);
        this._logger.info(`Found ${this.validators.length} validator(s) from BDNS`);
        this._logger.debug(`Validator(s) from BDNS: ${this.validators.map((validator) => validator.DID).join(", ")}`);
    }
}

function create(...params) {
    return new ConsensusCore(...params);
}

module.exports = {
    create,
};
