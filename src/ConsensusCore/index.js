/*
A configurable consensus core that can have 3 consensus strategies
 - SVBC - Single Validator BrickLedger Consensus:  Only one node is accepting commands and propose BrickBlocks. A block has only one BrickBlock.
 - MVBC - Multiple Validators BrickLedger Consensus: run the BrickLedger consensus between validators
 - OBAC - Other Blockchain Adapter Consensus: Delegates Consensus to a blockchain adapter that is using other blockchain network for consensus regrading the blocks of commands 
*/

const PendingBlock = require("./PendingBlock");
const PBlock = require("../PBlock");
const Logger = require("../Logger");
const { clone } = require("../utils/object-utils");
const {
    getLocalLatestBlockInfo,
    getValidatedBlocksWriteStream,
    saveBlockInBricks,
    appendValidatedBlockHash,
    loadValidatorsFromBdns,
    savePBlockInBricks,
    areNonInclusionListsEqual,
} = require("./utils");
const ValidatorSynchronizer = require("./ValidatorSynchronizer");
const PBlockAddedMessage = require("../Broadcaster/PBlockAddedMessage");

const DEFAULT_PENDING_BLOCKS_TIMEOUT_MS = 1000 * 60; // 1 minute
const DEFAULT_NON_INCLUSION_CHECK_TIMEOUT_MS = 1000 * 60; // 1 minute

class ConsensusCore {
    constructor(
        validatorDID,
        validatorURL,
        domain,
        storageFolder,
        brickStorage,
        executionEngine,
        broadcaster,
        notifier,
        pendingBlocksTimeoutMs,
        nonInclusionCheckTimeoutMs,
        validatorContractExecutorFactory
    ) {
        this._validatorDID = validatorDID;
        this._validatorURL = validatorURL;
        this._domain = domain;
        this._storageFolder = storageFolder;

        this._pendingBlocksTimeoutMs = pendingBlocksTimeoutMs || DEFAULT_PENDING_BLOCKS_TIMEOUT_MS;
        this._nonInclusionCheckTimeoutMs = nonInclusionCheckTimeoutMs || DEFAULT_NON_INCLUSION_CHECK_TIMEOUT_MS;

        this._brickStorage = brickStorage;
        this._executionEngine = executionEngine;
        this._broadcaster = broadcaster;
        this._notifier = notifier;
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

        this.validators = await this._loadValidators();

        this._logger.info(`Checking local blocks history...`);
        const latestBlockInfo = await getLocalLatestBlockInfo(this._storageFolder, this._domain);
        const { number, hash } = latestBlockInfo;
        this._latestBlockNumber = number;
        this._latestBlockHash = hash;
        this._logger.info(`Found ${number} local block(s), with the latest block hash being ${hash}...`);

        // this.validatedBlocksWriteStream = await getValidatedBlocksWriteStream(this._storageFolder, this._domain);

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
                    this._brickStorage,
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

        // return a promise when the final consensus is reached
        return new Promise(async (resolve, reject) => {
            pBlock.onConsensusFinished = (error, result) => {
                if (error) {
                    return reject(error);
                }
                resolve(result);
            };

            reject = $$.makeSaneCallback(reject);
            try {
                await this._addPBlockToPendingBlock(pBlock);
            } catch (error) {
                reject(error);
            }
        });
    }

    async addExternalPBlockInConsensus(pBlockMessage, callback) {
        callback = $$.makeSaneCallback(callback);

        this.addExternalPBlockInConsensusAsync(pBlockMessage)
            .then((result) => callback(undefined, result))
            .catch((error) => callback(error));
    }

    async addExternalPBlockInConsensusAsync(pBlockMessage) {
        if (!this._isRunning) {
            throw new Error("Consensus not yet running");
        }

        if (!(pBlockMessage instanceof PBlockAddedMessage)) {
            throw new Error("pBlock not instance of PBlock");
        }

        let pBlock;
        if (pBlockMessage.pBlockHashLinkSSI) {
            this._logger.debug(`Getting external pBlock ${pBlockMessage.pBlockHashLinkSSI} from pBlock message`, pBlockMessage);
            const { validatorDID, validatorURL, pBlockHashLinkSSI } = pBlockMessage;
            const validatorContractExecutor = this._validatorContractExecutorFactory.create(
                this._domain,
                this._validatorDID,
                validatorDID,
                validatorURL
            );
            pBlock = await validatorContractExecutor.getPBlockAsync(pBlockHashLinkSSI);
            pBlock.hashLinkSSI = await savePBlockInBricks(pBlock, this._domain, this._brickStorage);
        } else {
            this._logger.debug(`Received empty external pBlock`, pBlockMessage);
            pBlock = new PBlock(pBlockMessage);
        }
        this._logger.debug(`Validating external pBlock...`);
        await this.validatePBlockAsync(pBlock);

        // dont' await processing finish in order to return to calling mmember
        this._addPBlockToPendingBlock(pBlock);
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
            this._logger.error("Wanting to validate old PBlock", pBlock);
            throw new Error(
                `pBlock has block number ${blockNumber} less than or equal to the latest block number ${this._latestBlockNumber}`
            );
        }

        await pBlock.validateSignature();
    }

    setValidatorNonInclusion(validatorNonInclusion, callback) {
        callback = $$.makeSaneCallback(callback);

        this.setValidatorNonInclusionAsync(validatorNonInclusion)
            .then((result) => callback(undefined, result))
            .catch((error) => callback(error));
    }

    async setValidatorNonInclusionAsync(validatorNonInclusion) {
        if (!this._isRunning) {
            throw new Error("Consensus not yet running");
        }

        const { blockNumber } = validatorNonInclusion;

        const pendingBlock = this._pendingBlocksByBlockNumber[blockNumber];
        if (!pendingBlock) {
            const errorMessage = `Unexisting block with number ${blockNumber}`;
            this._logger.warn(errorMessage);
            throw new Error(errorMessage);
        }

        await pendingBlock.waitForSafeProcessing();

        pendingBlock.setValidatorNonInclusionAsync(validatorNonInclusion);
        this._checkForPendingBlockNonInclusionMajorityAsync(pendingBlock);
    }

    getPBlockProposedForConsensus(blockNumber, validatorDID, callback) {
        callback = $$.makeSaneCallback(callback);

        this.getPBlockProposedForConsensusAsync(blockNumber, validatorDID)
            .then((result) => callback(undefined, result))
            .catch((error) => callback(error));
    }

    async getPBlockProposedForConsensusAsync(blockNumber, validatorDID) {
        const pendingBlock = this._pendingBlocksByBlockNumber[blockNumber];
        if (!pendingBlock) {
            const errorMessage = `Unexisting block with number ${blockNumber}`;
            this._logger.error(errorMessage);
            throw new Error(errorMessage);
        }

        const validatorPBlock = pendingBlock.pBlocks.find((pBlock) => pBlock.validatorDID === validatorDID);
        if (!pendingBlock) {
            const errorMessage = `Unexisting pBlock with validator '${validatorDID}' for block number ${blockNumber}`;
            this._logger.error(errorMessage);
            throw new Error(errorMessage);
        }

        return validatorPBlock;
    }

    isConsensusRunningForBlockNumber(blockNumber) {
        return (
            this._pendingBlocksByBlockNumber[blockNumber] && this._pendingBlocksByBlockNumber[blockNumber].isConsensusRunning()
        );
    }

    async _addPBlockToPendingBlock(pBlock) {
        const { validatorDID, blockNumber } = pBlock;

        let pendingBlock = this._pendingBlocksByBlockNumber[blockNumber];

        if (!pendingBlock) {
            await this._createPendingBlockForBlockNumber(blockNumber);
            pendingBlock = this._pendingBlocksByBlockNumber[blockNumber];
        }

        await pendingBlock.waitForSafeProcessing();

        pendingBlock.processing = new Promise(async (resolve, reject) => {
            try {
                pendingBlock.validateCanReceivePBlock(pBlock);
                pendingBlock.validatePBlockValidator(pBlock);
                pendingBlock.validateNoPBlockFromValidator(validatorDID);

                pendingBlock.addPBlock(pBlock);

                if (pendingBlock.canFinalizeConsensus()) {
                    this._finalizeConsensusForPendingBlockAsync(pendingBlock); // no need to await in order to finish processing
                }
            } catch (error) {
                this._logger.error(
                    `A processing error has occurred while adding a pBlock to pending block number ${blockNumber}`,
                    pBlock,
                    error
                );
                return reject(error);
            }

            resolve(); // mark processing finished
        });

        await pendingBlock.processing;
    }

    async _createPendingBlockForBlockNumber(blockNumber) {
        const pendingBlock = new PendingBlock(this._domain, this._validatorDID, blockNumber);
        this._pendingBlocksByBlockNumber[blockNumber] = pendingBlock;

        pendingBlock.processing = new Promise(async (resolve, reject) => {
            try {
                // add validators after setting pendingBlock in order to avoid race condition issues
                const validators = await this._loadValidators();
                pendingBlock.setValidators(validators);

                pendingBlock.startPendingBlocksPhase({
                    timeoutMs: this._pendingBlocksTimeoutMs,
                    onFinalizeConsensusAsync: () => {
                        return this._finalizeConsensusForPendingBlockAsync(pendingBlock);
                    },
                    onStartNonInclusionPhase: () => {
                        pendingBlock.startNonInclusionPhase({
                            timeout: this._nonInclusionCheckTimeoutMs,
                            checkForPendingBlockNonInclusionMajorityAsync: () => {
                                return this._checkForPendingBlockNonInclusionMajorityAsync(pendingBlock);
                            },
                            broadcastValidatorNonInclusion: (unreachableValidators) => {
                                this._broadcaster.broadcastValidatorNonInclusion(blockNumber, unreachableValidators);
                            },
                        });
                    },
                });
            } catch (error) {
                this._logger.error(`A processing error has occurred while creating pending block number ${blockNumber}`, error);
                return reject(error);
            }

            resolve(); // mark processing finished
        });
    }

    async _checkForPendingBlockNonInclusionMajorityAsync(pendingBlock) {
        const { blockNumber } = pendingBlock;
        this._logger.info(`Checking if consensus for pending block ${blockNumber} has a non inclusion majority...`);

        const nonInclusionMajority = pendingBlock.getNonInclusionMajority();
        if (!nonInclusionMajority) {
            this._logger.info(`No non inclusion majority found for pending block ${blockNumber}`);
            return false;
        }

        this._logger.info(
            `Found non inclusion majority for pending block ${blockNumber} has a non inclusion majority...`,
            nonInclusionMajority
        );

        const { ownUnreachableValidators } = pendingBlock;
        if (areNonInclusionListsEqual(ownUnreachableValidators, nonInclusionMajority)) {
            this._logger.info(`The pending block own's non inclusion validators is the same as the non inclusion majority`);

            pendingBlock.clearNonInclusionCheckTimeout();
            this._finalizeConsensusForPendingBlockAsync(pendingBlock); // no need to await in order to finish processing
            return true;
        }

        this._logger.info(
            `The pending block own's non inclusion validators is different then the non inclusion majority: [own/majority]`,
            ownUnreachableValidators,
            nonInclusionMajority
        );

        const majorityValidatorDIDsSet = new Set(nonInclusionMajority.map((x) => x.DID));
        const ownUnreachableValidatorDIDsSet = new Set(ownUnreachableValidators.map((x) => x.DID));

        const pendingBlockExtraValidatorDIDs = [...majorityValidatorDIDsSet].filter(
            (x) => !ownUnreachableValidatorDIDsSet.has(x)
        );
        if (pendingBlockExtraValidatorDIDs.length) {
            this._logger.info(
                `The pending block has pBlocks from validators marked as unreachable by the majority`,
                pendingBlockExtraValidatorDIDs
            );

            pendingBlock.removePBlocksForValidatorDIDs(pendingBlockExtraValidatorDIDs);
        }

        const pendingBlockMissingValidatorDIDs = [...ownUnreachableValidatorDIDsSet].filter(
            (x) => !majorityValidatorDIDsSet.has(x)
        );

        if (pendingBlockMissingValidatorDIDs.length) {
            this._logger.info(
                `The pending block has missing pBlocks as compared by the non inclusion majority`,
                pendingBlockMissingValidatorDIDs
            );
            const { pBlocks, validators, validatorNonInclusions } = pendingBlock;
            const reachableValidatorDIDs = pBlocks.map((pBlock) => pBlock.validatorDID);

            for (let i = 0; i < pendingBlockMissingValidatorDIDs.length; i++) {
                const missingValidatorDID = pendingBlockMissingValidatorDIDs[i];
                this._logger.debug(`Trying to get missing pBlock by validator ${missingValidatorDID}...`);

                const validatorDIDsWithMissingValidatorPBlock = reachableValidatorDIDs.filter((did) => {
                    const nonInclusionsForValidator = validatorNonInclusions[did];
                    if (!nonInclusionsForValidator) {
                        // we have received pBlocks for this DID, but we haven't received the non inclusion voting from him, so try to get the missing pBlock
                        return true;
                    }

                    const isMissingValidatorReachableForDID = !nonInclusionsForValidator.some(
                        (nonInclusion) => nonInclusion.DID === did
                    );
                    return isMissingValidatorReachableForDID;
                });

                for (let j = 0; j < validatorDIDsWithMissingValidatorPBlock.length; j++) {
                    const validatorDID = validatorDIDsWithMissingValidatorPBlock[j];
                    const validatorURL = validators.find((validator) => validator.DID === validatorDID);
                    const validatorContractExecutor = this._validatorContractExecutorFactory.create(
                        this._domain,
                        this._validatorDID,
                        validatorDID,
                        validatorURL
                    );

                    try {
                        const missingPBlock = await validatorContractExecutor.getPBlockProposedByValidatorAsync(
                            blockNumber,
                            missingValidatorDID
                        );

                        pBlocks.push(missingPBlock);

                        break; // the missing pBlock has been loaded so continue with the next one
                    } catch (error) {
                        this._logger.error(
                            `Failed to load missing pBlock by validator '${missingValidatorDID}' by querying it from validator '${validatorDID}'`,
                            error
                        );
                    }
                }
            }

            const wereAllMissingPBlocksLoaded = pendingBlockMissingValidatorDIDs.every((missingValidatorDID) =>
                pBlocks.some((pBlock) => pBlock.validatorDID === missingValidatorDID)
            );

            if (wereAllMissingPBlocksLoaded) {
                this._logger.info("All missing pBlocks were successfully loaded, so the consensus can be finalized");
                this._finalizeConsensusForPendingBlockAsync(pendingBlock); // no need to await in order to finish processing
                return true;
            } else {
                this._logger.warn("Not all missing pBlocks were successfully loaded!");
            }
        }

        return false;
    }

    async _finalizeConsensusForPendingBlockAsync(pendingBlock) {
        pendingBlock.startFinalizeConsensus();

        try {
            // consensus finished with success, so generate block and broadcast it
            const block = pendingBlock.createBlock(this._latestBlockHash);
            this._logger.info(`Created block for block number ${pendingBlock.blockNumber}...`, block);
            await this._executeBlock(block, pendingBlock.pBlocks);
            pendingBlock.endFinalizeConsensus();
            await this._notifyPBlocksConsensusFinished(pendingBlock.pBlocks);
        } catch (error) {
            this._logger.error("Error while finalizing pBlock consensus", error, pendingBlock);
            throw error;
        }
    }

    async _executeBlock(block, pBlocks) {
        await this._storeBlock(block);
        await this._executePBlocks(pBlocks);
        await this._updateLatestBlockInfo(block);
    }

    async _storeBlock(block) {
        this._logger.info("Storing block", block);
        const blockHashLinkSSI = await saveBlockInBricks(block, this._domain, this._brickStorage);
        block.hashLinkSSI = blockHashLinkSSI;
    }

    async _executePBlocks(pBlocks) {
        this._logger.debug("Executing pBlocks...");
        const populatedPBlocks = pBlocks.filter((pBlock) => !pBlock.isEmpty);

        for (let index = 0; index < populatedPBlocks.length; index++) {
            const pBlock = populatedPBlocks[index];

            try {
                if (pBlock.validatorDID !== this._validatorDID.getIdentifier()) {
                    // we don't need to execute the current validator's own PBlock since it was executed when the commands were executed
                    // so we just need to call the callback
                    await this._executionEngine.executePBlock(pBlock);
                }
            } catch (error) {
                this._logger.error("Failed to execute pBlock", pBlock);
                // throw error; // todo: find best approach in this situation
            }
        }
    }

    async _notifyPBlocksConsensusFinished(pBlocks) {
        this._logger.debug("Notifying pBlocks of consensus finished...", pBlocks);
        pBlocks
            .filter((pBlock) => typeof pBlock.onConsensusFinished === "function")
            .forEach((pBlock) => {
                try {
                    pBlock.onConsensusFinished();
                } catch (error) {
                    // we just notify the pblock that the consensus has finished
                }
            });
    }

    async _updateLatestBlockInfo(block) {
        this._logger.info(`Updating latest block number to ${block.blockNumber} and latest block hash to ${block.hashLinkSSI}`);
        this._latestBlockNumber = block.blockNumber;
        this._latestBlockHash = block.hashLinkSSI;

        const validatedBlocksWriteStream = await getValidatedBlocksWriteStream(this._storageFolder, this._domain);
        await appendValidatedBlockHash(this._latestBlockHash, validatedBlocksWriteStream);
        validatedBlocksWriteStream.close();

        this._notifier.notifyNewBlock({ number: block.blockNumber, hash: block.hashLinkSSI });
    }

    async _loadValidators() {
        this._logger.info(`Loading validators...`);
        const validators = await loadValidatorsFromBdns(this._domain, this._executionEngine);
        this._logger.info(`Found ${validators.length} validator(s) from BDNS`);
        this._logger.debug(`Validator(s) from BDNS: ${validators.map((validator) => validator.DID).join(", ")}`);

        return validators;
    }
}

function create(...params) {
    return new ConsensusCore(...params);
}

module.exports = {
    create,
};
