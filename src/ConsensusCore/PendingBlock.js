const { CONSENSUS_PHASES, areNonInclusionListsEqual } = require("./utils");
const Logger = require("../Logger");
const Block = require("../Block");

function sortPBlocks(pBlocks) {
    const sortHashes = (a, b) => {
        if (typeof a === "string" && typeof b === "string") {
            return a.localeCompare(b);
        }

        const aHash = typeof a.hashLinkSSI === "string" ? a.hashLinkSSI : a.hashLinkSSI.getIdentifier();
        const bHash = typeof b.hashLinkSSI === "string" ? b.hashLinkSSI : b.hashLinkSSI.getIdentifier();
        return aHash.localeCompare(bHash);
    };

    pBlocks.sort(sortHashes);
}

class PendingBlock {
    constructor(domain, validatorDID, blockNumber) {
        this._logger = new Logger(
            `[Bricksledger][${domain}][${validatorDID.getIdentifier()}][Consensus][PendingBlock][${blockNumber}]`
        );

        this.blockNumber = blockNumber;

        this.startTime = Date.now();
        this.pBlocks = [];
        this.phase = CONSENSUS_PHASES.PENDING_BLOCKS;
    }

    setValidators(validators) {
        this.validators = validators;
    }

    addPBlock(pBlock) {
        this.pBlocks.push(pBlock);
    }

    clearPendingBlockTimeout() {
        if (this.pendingBlocksTimeout) {
            clearTimeout(this.pendingBlocksTimeout);
            this.pendingBlocksTimeout = null;
        }
    }

    clearNonInclusionCheckTimeout() {
        if (this.nonInclusionCheckTimeout) {
            clearTimeout(this.nonInclusionCheckTimeout);
            this.nonInclusionCheckTimeout = null;
        }
    }

    validateCanReceivePBlock(pBlock) {
        const { phase, blockNumber } = this;
        if (phase !== CONSENSUS_PHASES.PENDING_BLOCKS) {
            const errorMessage = `Pending block number ${blockNumber} is not still at the phase of receiving pBlocks, but at ${phase}`;
            this._logger.error(errorMessage, "pBlock refused for consensus", pBlock);
            throw new Error(errorMessage);
        }
    }

    validatePBlockValidator(pBlock) {
        const { validatorDID } = pBlock;
        this._logger.info(`Checking if pBlock's validator '${validatorDID}' is recognized...`);
        const isValidatorRecognized = this.validators.some((validator) => validator.DID === validatorDID);
        if (!isValidatorRecognized) {
            const errorMessage = `Pblock '${pBlock.hashLinkSSI}' has a nonrecognized validator '${validatorDID}'`;
            this._logger.error(errorMessage);
            throw new Error(errorMessage);
        }
    }

    validateNoPBlockFromValidator(validatorDID) {
        const { blockNumber, pBlocks } = this;
        const isPBlockFromValidatorAlreadyAdded = pBlocks.some((pBlock) => pBlock.validatorDID === validatorDID);
        if (isPBlockFromValidatorAlreadyAdded) {
            const errorMessage = `Validator '${validatorDID}' already had a pBlock for blockNumber ${blockNumber}`;
            this._logger.error(errorMessage);
            throw new Error(errorMessage);
        }
    }

    startPendingBlocksPhase({ timeoutMs, onFinalizeConsensusAsync, onStartNonInclusionPhase }) {
        this.clearPendingBlockTimeout();

        const pendingBlocksTimeout = setTimeout(async () => {
            const { phase } = this; // phase can be changed until timeout is run

            this._logger.debug(`pendingBlocksTimeout triggered...`);

            await this.waitForSafeProcessing();

            this._logger.debug(`pendingBlocksTimeout started...`);

            try {
                // the timeout has occured after the consensus finalization phase started, so we ignore the timeout
                if (phase === CONSENSUS_PHASES.FINALIZING) {
                    this._logger.debug(`pendingBlocksTimeout found the phase to be ${phase}, so canceling timeout...`);
                    return;
                }

                if (this.canFinalizeConsensus()) {
                    await onFinalizeConsensusAsync();
                    return;
                }

                const { validators, pBlocks } = this;
                const canProceedToNonInclusionPhase = pBlocks.length >= Math.floor(validators.length / 2) + 1;
                if (!canProceedToNonInclusionPhase) {
                    this._logger.info(
                        `Consensus for pBlock has received only ${pBlocks.length} pBlock(s) from a total of ${validators.length} validators`,
                        `so it cannot proceed to non inclusion phase yet. Waiting another pendingBlocksTimeout`
                    );

                    this.clearPendingBlockTimeout();
                    this.startPendingBlocksPhase({ timeoutMs, onFinalizeConsensusAsync, onStartNonInclusionPhase });
                    return;
                }

                onStartNonInclusionPhase();
            } catch (error) {
                this._logger.error(`An error has occurred while running pendingBlocksTimeout`, error);

                // an error has occured to start another pending blocks phase check
                this.startPendingBlocksPhase({ timeoutMs, onFinalizeConsensusAsync, onStartNonInclusionPhase });
            }
        }, timeoutMs);

        this.pendingBlocksTimeout = pendingBlocksTimeout;
    }

    canFinalizeConsensus() {
        const { validators, pBlocks } = this;
        this._logger.info(`Checking if consensus for pending block can be finalized...`);

        const canFinalizeConsensus = validators.length === pBlocks.length;
        if (canFinalizeConsensus) {
            return true;
        }

        this._logger.info(
            `Consensus for pBlock has received ${pBlocks.length} pBlock(s) from a total of ${validators.length} validators`
        );
        return false;
    }

    finalizeConsensus() {
        this._logger.info(`Finalizing consensus for pBlock...`);

        this.phase = CONSENSUS_PHASES.FINALIZING;
        this.clearPendingBlockTimeout();
        this.clearNonInclusionCheckTimeout();
    }

    removePBlocksForValidatorDIDs(validatorDIDs) {
        const { pBlocks } = this;
        validatorDIDs.forEach((validatorDID) => {
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

    startNonInclusionPhase({ timeout, checkForPendingBlockNonInclusionMajorityAsync, broadcastValidatorNonInclusion }) {
        const { validators, pBlocks } = this;

        this.clearNonInclusionCheckTimeout();

        const nonInclusionCheckTimeout = setTimeout(async () => {
            const { phase } = this; // phase can be changed until timeout is run

            this._logger.debug(`nonInclusionCheckTimeout triggered...`);

            await this.waitForSafeProcessing();

            this._logger.debug(`nonInclusionCheckTimeout started...`);

            try {
                // the timeout has occured after the consensus finalization phase started, so we ignore the timeout
                if (phase === CONSENSUS_PHASES.FINALIZING) {
                    this._logger.debug(`pendingBlocksTimeout found the phase to be ${phase}, so canceling timeout...`);
                    return;
                }

                if (phase === CONSENSUS_PHASES.NON_INCLUSION_CHECK) {
                    const canNonInclusionPhaseBeClosed = await checkForPendingBlockNonInclusionMajorityAsync();
                    if (canNonInclusionPhaseBeClosed) {
                        return;
                    }

                    this._logger.info(
                        `non inclusion phase cannot be closed due to missing majority, so starting a new voting phase...`
                    );
                    this.startNonInclusionPhase({
                        timeout,
                        checkForPendingBlockNonInclusionMajorityAsync,
                        broadcastValidatorNonInclusion,
                    });
                }
            } catch (error) {
                this._logger.error(`An error has occurred while running nonInclusionCheckTimeout`, error);

                // an error has occured to start another non inclusion phase check
                this.startNonInclusionPhase({
                    timeout,
                    checkForPendingBlockNonInclusionMajorityAsync,
                    broadcastValidatorNonInclusion,
                });
            }
        }, timeout);

        this.phase = CONSENSUS_PHASES.NON_INCLUSION_CHECK;
        this._logger.info(
            `Consensus timeout for pBlock has been reached. Received only ${pBlocks.length} pBlocks out of ${validators.length} validators. Enter non inclusion phase`
        );
        this.nonInclusionCheckTimeout = nonInclusionCheckTimeout;
        this.validatorNonInclusions = {};
        this.ownUnreachableValidators = validators.filter((validator) =>
            pBlocks.every((pBlock) => pBlock.validatorDID !== validator.DID)
        );

        const unreachableValidators = this.ownUnreachableValidators;
        this._logger.info(
            `Consensus detected ${unreachableValidators.length} unreachable validator(s) for pBlock`,
            JSON.stringify(unreachableValidators)
        );

        broadcastValidatorNonInclusion(unreachableValidators);
    }

    setValidatorNonInclusionAsync(validatorNonInclusion) {
        const { validatorDID, blockNumber, unreachableValidators } = validatorNonInclusion;

        const { phase, validatorNonInclusions } = this;
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

        this._logger.debug(`Received non inclusion message from '${validatorDID}' for block`, unreachableValidators);

        validatorNonInclusions[validatorDID] = unreachableValidators;

        this._checkForPendingBlockNonInclusionMajority(pendingBlock);
    }

    getNonInclusionMajority() {
        const { ownUnreachableValidators, validatorNonInclusions } = this;
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

        const isMajorityFound = sameNonInclusionMaxCount >= Math.floor(totalNonInclusionsPresent / 2) + 1;
        if (!isMajorityFound) {
            return null;
        }

        const nonInclusionMajorityKey = Object.keys(nonInclusionsWithCount).find(
            (nonInclusion) => nonInclusionsWithCount[nonInclusion].count === sameNonInclusionMaxCount
        );
        const nonInclusionMajority = nonInclusionsWithCount[nonInclusionMajorityKey];

        return nonInclusionMajority.unreachableValidators;
    }

    async waitForSafeProcessing() {
        if (this.processing) {
            try {
                await this.processing;
            } catch (error) {
                // an error has occured during the previous processing logic, so we can ignore it
            }
        }
    }

    createBlock(latestBlockHash) {
        const participatingPBlockHashLinks = this.pBlocks.filter((pBlock) => !pBlock.isEmpty).map((pBlock) => pBlock.hashLinkSSI);
        sortPBlocks(participatingPBlockHashLinks);

        const block = {
            pbs: participatingPBlockHashLinks,
            blockNumber: this.blockNumber,
            previousBlock: latestBlockHash,
        };

        return new Block(block);
    }
}

module.exports = PendingBlock;
