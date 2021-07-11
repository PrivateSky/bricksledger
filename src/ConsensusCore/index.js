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
const ValidatorSynchronizer = require("./ValidatorSynchronizer");
const PBlockAddedMessage = require("../Broadcaster/PBlockAddedMessage");

const CONSENSUS_PHASES = {
    PENDING_BLOCKS: "PENDING_BLOCKS",
    NON_INCLUSION_CHECK: "NON_INCLUSION_CHECK",
    FINALIZING: "FINALIZING",
};

const DEFAULT_PENDING_BLOCKS_TIMEOUT_MS = 1000 * 60; // 1 minute
const DEFAULT_NON_INCLUSION_CHECK_TIMEOUT_MS = 1000 * 60; // 1 minute

function areNonInclusionListsEqual(array1, array2) {
    if (array1.length !== array2.length) {
        return false;
    }
    const array1ValidatorDIDs = array1.map((x) => x.validatorDID);
    array1ValidatorDIDs.sort();

    const array2ValidatorDIDs = array2.map((x) => x.validatorDID);
    array2ValidatorDIDs.sort();

    return array1ValidatorDIDs.join(",") === array2ValidatorDIDs.join(",");
}

function getPendingBlockNonInclusionMajority(pendingBlock) {
    const { ownUnreachableValidators, validatorNonInclusions } = pendingBlock;
    let allNonInclusions = [ownUnreachableValidators, ...Object.values(validatorNonInclusions)];
    const totalNonInclusionsPresent = allNonInclusions.length;
    const nonInclusionsWithCount = {};

    while (allNonInclusions.length) {
        const nonInclusionToSearch = allNonInclusions.shift();
        const nonInclusionToSearchDIDs = nonInclusionToSearch.map((x) => x.DID);
        nonInclusionToSearchDIDs.sort();
        const nonInclusionToSearchKey = nonInclusionToSearchDIDs.join(",");

        const remainingCount = allNonInclusions.length;

        const remainingNonInclusions = allNonInclusions.filter(
            (nonInclusion) => !areNonInclusionListsEqual(nonInclusionToSearch, nonInclusion)
        );

        const nonInclusionToSearchMatchCount = remainingCount - remainingNonInclusions.length + 1;
        nonInclusionsWithCount[nonInclusionToSearchKey] = {
            unreachableValidators: nonInclusionToSearch,
            count: nonInclusionToSearchMatchCount,
        };

        allNonInclusions = remainingNonInclusions;
    }

    const nonInclusionCounts = Object.values(nonInclusionsWithCount).map((x) => x.count);
    const sameNonInclusionMaxCount = Math.max(...nonInclusionCounts);

    const isMajorityFound = sameNonInclusionMaxCount > Math.floor(totalNonInclusionsPresent / 2) + 1;
    if (!isMajorityFound) {
        return null;
    }

    const nonInclusionMajorityKey = Object.keys(nonInclusionsWithCount).find(
        (nonInclusion) => nonInclusionsWithCount[nonInclusion].count === sameNonInclusionMaxCount
    );
    const nonInclusionMajority = nonInclusionsWithCount[nonInclusionMajorityKey];

    return nonInclusionMajority.unreachableValidators;
}

class ConsensusCore {
    constructor(
        validatorDID,
        validatorURL,
        domain,
        storageFolder,
        brickStorage,
        executionEngine,
        broadcaster,
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
                    this._storageFolder,
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

    async addExternalPBlockInConsensus(pBlockMessage) {
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
            const validatorContractExecutor = validatorContractExecutorFactory.create(this._domain, validatorDID, validatorURL);
            pBlock = await validatorContractExecutor.getPBlockAsync(pBlockHashLinkSSI);
        } else {
            this._logger.debug(`Received empty external pBlock`, pBlockMessage);
            pBlock = new PBlock(pBlockMessage);
        }
        this._logger.debug(`Validating external pBlock...`);
        await this.validatePBlockAsync(pBlock);

        await this._addPBlockToPendingBlock(pBlock);
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

        const { validatorDID, blockNumber, unreachableValidators } = validatorNonInclusion;

        const pendingBlock = this._pendingBlocksByBlockNumber[blockNumber];
        if (!pendingBlock) {
            const errorMessage = `Unexisting block with number ${blockNumber}`;
            this._logger.warn(errorMessage);
            throw new Error(errorMessage);
        }

        const { phase, validatorNonInclusions } = pendingBlock;
        if (phase !== CONSENSUS_PHASES.NON_INCLUSION_CHECK) {
            const errorMessage = `Block with number ${blockNumber} not in non inclusion phase, but in ${phase}`;
            this._logger.warn(errorMessage);
            throw new Error(errorMessage);
        }

        if (validatorNonInclusions[validatorDID]) {
            const errorMessage = `Block with number ${blockNumber} has already received a non inclusion response`;
            this._logger.warn(errorMessage, "existing/new", validatorNonInclusions[validatorDID], unreachableValidators);
            throw new Error(errorMessage);
        }

        this._logger.debug(
            `Received non inclusion message from '${validatorDID}' for block number ${blockNumber}`,
            unreachableValidators
        );

        validatorNonInclusions[validatorDID] = unreachableValidators;

        this._checkForPendingBlockNonInclusionMajority(pendingBlock);
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

    async _addPBlockToPendingBlock(pBlock) {
        const { validatorDID, blockNumber } = pBlock;

        let pendingBlock = this._pendingBlocksByBlockNumber[blockNumber];
        if (pendingBlock) {
            if (pendingBlock.phase !== CONSENSUS_PHASES.PENDING_BLOCKS) {
                const errorMessage = `Pending block number ${blockNumber} is not still at the phase of receiving pBlocks, but at ${pendingBlock.phase}`;
                this._logger.error(errorMessage, "pBlock refused for consensus", pBlock);
                throw new Error(errorMessage);
            }
        } else {
            await this._createPendingBlockForBlockNumber(blockNumber);
            pendingBlock = this._pendingBlocksByBlockNumber[blockNumber];
        }

        const { pBlocks, validators } = pendingBlock;

        this._logger.info(`Checking if pBlock's validator '${validatorDID}' is recognized...`);
        const isValidatorRecognized = validators.some((validator) => validator.DID === validatorDID);
        if (!isValidatorRecognized) {
            const errorMessage = `Pblock '${pBlock.hashLinkSSI}' has a nonrecognized validator '${validatorDID}'`;
            this._logger.error(errorMessage);
            throw new Error(errorMessage);
        }

        const isPBlockFromValidatorAlreadyAdded = pBlocks.some((pBlock) => pBlock.validatorDID === validatorDID);
        if (isPBlockFromValidatorAlreadyAdded) {
            const errorMessage = `Validator '${validatorDID}' already had a pBlock for blockNumber ${blockNumber}`;
            this._logger.error(errorMessage);
            throw new Error(errorMessage);
        }

        pBlocks.push(pBlock);

        if (await this._checkForPendingBlockConsensusFinalization(pendingBlock)) {
            this._finalizeConsensusForPendingBlock(pendingBlock);
        }
    }

    async _createPendingBlockForBlockNumber(blockNumber) {
        const pendingBlocksTimeout = setTimeout(async () => {
            this._logger.debug(`pendingBlocksTimeout triggered for block number ${blockNumber}...`);
            const pendingBlock = this._pendingBlocksByBlockNumber[blockNumber];
            // the timeout has occured after the consensus finalization phase started, so we ignore the timeout
            if (pendingBlock.phase === CONSENSUS_PHASES.FINALIZING) {
                this._logger.debug(
                    `pendingBlocksTimeout found the block number ${blockNumber} phase to be ${pendingBlock.phase}, so canceling timeout...`
                );
                return;
            }

            if (await this._checkForPendingBlockConsensusFinalization(pendingBlock)) {
                await this._finalizeConsensusForPendingBlock(pendingBlock);
                return;
            }

            this._startNonInclusionPhase(pendingBlock);
        }, this._pendingBlocksTimeoutMs);

        const pendingBlock = {
            blockNumber,
            startTime: Date.now(),
            pBlocks: [],
            pendingBlocksTimeout,
            phase: CONSENSUS_PHASES.PENDING_BLOCKS,
        };
        this._pendingBlocksByBlockNumber[blockNumber] = pendingBlock;

        // add validators after setting pendingBlock in order to avoid race condition issues
        await this._loadValidators();
        pendingBlock.validators = clone(this.validators);
    }

    _startNonInclusionPhase(pendingBlock) {
        const { blockNumber, validators, pBlocks } = pendingBlock;

        const nonInclusionCheckTimeout = setTimeout(async () => {
            this._logger.debug(`nonInclusionCheckTimeout triggered for block number ${blockNumber}...`);
            // the timeout has occured after the consensus finalization phase started, so we ignore the timeout
            if (pendingBlock.phase === CONSENSUS_PHASES.FINALIZING) {
                this._logger.debug(
                    `pendingBlocksTimeout found the block number ${blockNumber} phase to be ${pendingBlock.phase}, so canceling timeout...`
                );
                return;
            }

            if (pendingBlock.phase === CONSENSUS_PHASES.NON_INCLUSION_CHECK) {
                const canNonInclusionPhaseBeClosed = await this._checkForPendingBlockNonInclusionMajority(pendingBlock);
                if (canNonInclusionPhaseBeClosed) {
                    return;
                }

                this._logger.info(
                    `block number ${blockNumber} non inclusion phase cannot be closed due to missing majority, so starting a new voting phase...`
                );
                this._startNonInclusionPhase(pendingBlock);
            }
        }, this._nonInclusionCheckTimeoutMs);

        pendingBlock.phase = CONSENSUS_PHASES.NON_INCLUSION_CHECK;
        this._logger.info(
            `Consensus timeout for pBlock ${blockNumber} has been reached. Received only ${pBlocks.length} pBlocks out of ${validators.length} validators. Enter non inclusion phase`
        );
        pendingBlock.nonInclusionCheckTimeout = nonInclusionCheckTimeout;
        pendingBlock.validatorNonInclusions = {};
        pendingBlock.ownUnreachableValidators = validators.filter((validator) =>
            pBlocks.every((pBlock) => pBlock.validatorDID !== validator.DID)
        );

        const unreachableValidators = pendingBlock.ownUnreachableValidators;
        this._logger.info(
            `Consensus detected ${unreachableValidators.length} unreachable validator(s) for pBlock ${blockNumber}`,
            JSON.stringify(unreachableValidators)
        );
        this._broadcaster.broadcastValidatorNonInclusion(blockNumber, unreachableValidators);
    }

    async _checkForPendingBlockNonInclusionMajority(pendingBlock) {
        const { blockNumber } = pendingBlock;
        this._logger.info(`Checking is consensus for pending block ${blockNumber} has a non inclusion majority...`);

        const nonInclusionMajority = getPendingBlockNonInclusionMajority(pendingBlock);
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

            clearTimeout(pendingBlock.nonInclusionCheckTimeout);
            this._finalizeConsensusForPendingBlock(pendingBlock);
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

            pendingBlockExtraValidatorDIDs.forEach((validatorDID) => {
                const { pBlocks } = pendingBlock;
                const validatorPBlockIndex = pBlocks.findIndex((pBlock) => pBlock.validatorDID === validatorDID);
                if (validatorPBlockIndex !== -1) {
                    this._logger.debug(`Removing pBlock from validator '${validatorDID}' since it's marked as unreachable...`);
                    pBlocks.splice(validatorPBlockIndex, 1);
                } else {
                    this._logger.warn(
                        `Validator '${validatorDID}' it's marked as unreachable but its block is not present in the pending block`
                    );
                }
            });
        }

        const pendingBlockMissingValidatorDIDs = [...ownUnreachableValidatorDIDsSet].filter(
            (x) => !majorityValidatorDIDsSet.has(x)
        );

        if (pendingBlockMissingValidatorDIDs.length) {
            this._logger.info(
                `The pending block has missing pBlocks as compared by the non inclusion majority`,
                pendingBlockMissingValidatorDIDs
            );
            // to do: get missing pblocks
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
                this._finalizeConsensusForPendingBlock(pendingBlock);
                return true;
            } else {
                this._logger.warn("Not all missing pBlocks were successfully loaded!");
            }
        }

        return false;
    }

    async _checkForPendingBlockConsensusFinalization(pendingBlock) {
        const { validators, pBlocks, blockNumber } = pendingBlock;
        this._logger.info(`Checking is consensus for pending block ${blockNumber} can be finalized...`);

        const canFinalizeConsensus = validators.length === pBlocks.length;
        if (canFinalizeConsensus) {
            return true;
        }

        this._logger.info(
            `Consensus for pBlock ${blockNumber} has received ${pBlocks.length} pBlock(s) from a total of ${validators.length} validators`
        );
        return false;
    }

    async _finalizeConsensusForPendingBlock(pendingBlock) {
        this._logger.info(`Finalizing consensus for pBlock ${pendingBlock.blockNumber}...`);

        pendingBlock.phase = CONSENSUS_PHASES.FINALIZING;
        clearTimeout(pendingBlock.pendingBlocksTimeout);

        try {
            // consensus finished with success, so generate block and broadcast it
            const block = createNewBlock(pendingBlock, this._latestBlockHash);
            this._logger.info(`Created block for block number ${pendingBlock.blockNumber}...`, block);
            this._executeBlock(block, pendingBlock.pBlocks);
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
        block.hashLinkSSI = blockHashLinkSSI.getIdentifier();
    }

    async _executePBlocks(pBlocks) {
        const populatedPBlocks = pBlocks.filter((pBlock) => !pBlock.isEmpty);
        sortPBlocks(populatedPBlocks);

        for (let index = 0; index < populatedPBlocks.length; index++) {
            const pBlock = populatedPBlocks[index];
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

        const validatedBlocksWriteStream = await getValidatedBlocksWriteStream(this._storageFolder, this._domain);
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
