const Logger = require("./Logger");
const PBlock = require("./PBlock");

async function savePBlockInBricks(pBlock, domain, brickStorage) {
    const openDSU = require("opendsu");
    const keySSISpace = openDSU.loadApi("keyssi");

    const pBlockBrickHash = await brickStorage.addBrickAsync(pBlock.getSerialisation());

    const hashLinkSSI = keySSISpace.createHashLinkSSI(domain, pBlockBrickHash);
    return hashLinkSSI.getIdentifier();
}

function createPBlock(validatorDID, commands, previousBlockHash, blockNumber) {
    const pBlockInfo = {
        validatorDID: validatorDID.getIdentifier(),
        commands,
        previousBlockHash,
        blockNumber,
    };
    const pBlock = new PBlock(pBlockInfo);
    pBlock.sign(validatorDID);

    return pBlock;
}

class PBlocksFactory {
    constructor(domain, validatorDID, brickStorage, consensusCore, broadcaster, maxPBlockSize, maxPBlockTimeMs) {
        this.domain = domain;
        this.validatorDID = validatorDID;
        this.brickStorage = brickStorage;
        this.consensusCore = consensusCore;
        this.broadcaster = broadcaster;

        this.pendingCommands = [];

        if (!maxPBlockSize) {
            maxPBlockSize = 100;
        }
        this.maxPBlockSize = maxPBlockSize;

        if (!maxPBlockTimeMs) {
            maxPBlockTimeMs = 1000 * 60; // 1 minute
        }
        this.maxPBlockTimeMs = maxPBlockTimeMs;

        this._latestPBlock = null;
        this._forceRequestedBlockNumbers = {};

        this._logger = new Logger(`[Bricksledger][${this.domain}][${this.validatorDID.getIdentifier()}][PBlocksFactory]`);
        this._logger.info("Create finished");

        this._startBlockTimeCheckTimeout();
    }

    addCommandForConsensus(pBlock, callback) {
        callback = $$.makeSaneCallback(callback);

        this.addCommandForConsensusAsync(pBlock)
            .then((result) => callback(undefined, result))
            .catch((error) => callback(error));
    }

    async addCommandForConsensusAsync(command) {
        this._logger.info(`Adding command for consensus with hash ${command.getHash()}...`);

        if (this._commandProcessing) {
            await this._commandProcessing;
        }

        this._commandProcessing = new Promise((resolve) => {
            try {
                this.pendingCommands.push(command);
                this._constructPBlockIfBlockSizeRestrictionReached();
            } catch (error) {
                this._logger.error(`Failed to add command with hash ${command.getHash()}`, error);
            }

            resolve(); // mark processing finished
        });
    }

    forcePBlockCreationForBlockNumberIfAbsent(blockNumber, callback) {
        callback = $$.makeSaneCallback(callback);

        this.forcePBlockCreationForBlockNumberIfAbsentAsync(blockNumber)
            .then((result) => callback(undefined, result))
            .catch((error) => callback(error));
    }

    async forcePBlockCreationForBlockNumberIfAbsentAsync(blockNumber) {
        this._logger.info(`Trying to force PBlock creation for block number ${blockNumber}...`);

        if (this._commandProcessing) {
            await this._commandProcessing;
        }

        this._commandProcessing = new Promise(async (resolve) => {
            try {
                const latestVerifiedBlockInfo = this.consensusCore.getLatestBlockInfo();
                const latestVerifiedBlockNumber = latestVerifiedBlockInfo.number;
                if (blockNumber <= latestVerifiedBlockNumber) {
                    this._logger.warn(
                        `Wanting to force pBlock creation for block number ${blockNumber} but latest confirmed consensus is already at block number ${latestVerifiedBlockNumber}`
                    );
                    return resolve();
                }

                let canForceCreateBlockNow = false;

                if (this._latestPBlock) {
                    this._logger.debug(`Found existing _latestPBlock`);
                    const currentBlockNumber = this._latestPBlock.blockNumber;
                    if (blockNumber < currentBlockNumber) {
                        this._logger.warn(
                            `Wanting to force pBlock creation for block number ${blockNumber} but consensus is already at block number ${currentBlockNumber}`
                        );
                        return resolve();
                    }

                    if (blockNumber === currentBlockNumber) {
                        this._logger.debug(
                            `Latest pBlock is already destinated for block number ${blockNumber}, so skipping force creation...`
                        );
                        return resolve();
                    }

                    const isConsensusStillRunningForCurrentBlockNumber = latestVerifiedBlockNumber === currentBlockNumber - 1;
                    if (isConsensusStillRunningForCurrentBlockNumber) {
                        if (this.consensusCore.isConsensusRunningForBlockNumber(currentBlockNumber)) {
                            this._forceRequestedBlockNumbers[blockNumber] = true;
                            this._logger.info(
                                `Latest pBlock (block number ${currentBlockNumber}) is currently awaiting consensus finalization, so keep force request for block number ${blockNumber}`
                            );
                        } else {
                            this._logger.warn(
                                `Latest pBlock (block number ${currentBlockNumber}) is in consensus status finalized, but not removed from pBlocksFactory, so removing it`
                            );
                            this._latestPBlock = null;
                            canForceCreateBlockNow = true;
                        }
                    } else {
                        const isPBlocksFactoryGoingToBeNotifiedOfCurrentConsensusEnd =
                            latestVerifiedBlockNumber === this._latestPBlock.blockNumber &&
                            !this.consensusCore.isConsensusRunningForBlockNumber(latestVerifiedBlockNumber + 1);
                        if (isPBlocksFactoryGoingToBeNotifiedOfCurrentConsensusEnd) {
                            this._forceRequestedBlockNumbers[blockNumber] = true;
                            this._logger.info(
                                `PBlocksFactory is waiting to be notified when processing for current pBlock is finished (since the next block is not yet started)...`
                            );
                            return resolve();
                        }

                        canForceCreateBlockNow = true;
                        if (currentBlockNumber <= latestVerifiedBlockNumber) {
                            this._logger.warn(
                                `Latest pBlock (block number ${currentBlockNumber}) is older than latest verified block number of ${latestVerifiedBlockNumber}, but not removed from pBlocksFactory, so removing it`
                            );
                            this._latestPBlock = null;
                        }
                    }
                } else {
                    this._logger.debug(`Didn't find existing _latestPBlock`);
                    if (latestVerifiedBlockNumber == blockNumber - 1) {
                        this._logger.debug(
                            `Wanting to force pBlock creation for block number ${blockNumber} and latest confirmed block is the previous one, so continuing`
                        );
                        canForceCreateBlockNow = true;
                    } else {
                        this._logger.debug(
                            `Wanting to force pBlock creation for block number ${blockNumber}, but latest confirmed block is at block number ${latestVerifiedBlockNumber}, so skipping it`
                        );
                    }
                }

                if (canForceCreateBlockNow) {
                    // restart timeout check
                    this._startBlockTimeCheckTimeout();

                    let pBlock = this._forceBuildPBlockFromAllCommands();
                    if (pBlock) {
                        this._logger.debug(`Created pBlock for block number ${blockNumber}`, pBlock);
                    } else {
                        this._logger.debug(`Created empty pBlock`);
                        pBlock = this._buildPBlock();
                    }

                    this._sendPBlockForConsensus(pBlock);
                }
            } catch (error) {
                this._logger.error(`Failed to force pBlock creation for block number ${blockNumber}`, error);
            }

            resolve(); // mark processing finished
        });
    }

    _startBlockTimeCheckTimeout() {
        this._clearBlockTimeCheckTimeout();

        this._blockTimeCheckTimeout = setTimeout(async () => {
            this._logger.info(`Reached block time restriction of ${this.maxPBlockTimeMs}ms`);

            if (this._commandProcessing) {
                await this._commandProcessing;
            }

            this._clearBlockTimeCheckTimeout();

            this._commandProcessing = new Promise(async (resolve) => {
                try {
                    // if we have commands then contruct the pBlock because of the block time restriction has been reached
                    if (this.pendingCommands.length !== 0) {
                        const pBlock = this._buildPBlockForMaxBlockSize();
                        if (pBlock) {
                            this._sendPBlockForConsensus(pBlock);
                        }
                    }
                } catch (error) {
                    this._logger.error(`Failed to add command with hash ${command.getHash()}`, error);
                }

                resolve(); // mark processing finished

                // start another timeout check
                this._startBlockTimeCheckTimeout();
            });
        }, this.maxPBlockTimeMs);
    }

    _forceBuildPBlockFromAllCommands() {
        if (!this.consensusCore.isRunning()) {
            throw new Error("Cannot build PBlock due to consensus not running");
        }

        const commands = this.pendingCommands.splice(0, this.pendingCommands.length);
        return this._buildPBlock(commands);
    }

    _buildPBlockForMaxBlockSize() {
        if (!this.consensusCore.isRunning()) {
            throw new Error("Cannot build PBlock due to consensus not running");
        }

        if (this._latestPBlock) {
            const latestVerifiedBlockInfo = this.consensusCore.getLatestBlockInfo();
            const currentConsensusBlockNumber = latestVerifiedBlockInfo.number + 1;

            if (this._latestPBlock.blockNumber === currentConsensusBlockNumber) {
                // the previous block hasn't been confirmed yet,
                // so we must wait until it's finished before constructing the next one

                this._logger.info(
                    "Previous PBlock not yet accepted. Waiting for it to finished before creating another...",
                    this._latestPBlock
                );
                return;
            }

            this._logger.info(
                `Consensus is currently at block number ${currentConsensusBlockNumber} and the local current pBlock is at ${this._latestPBlock.blockNumber}`
            );

            const isPBlocksFactoryGoingToBeNotifiedOfCurrentConsensusEnd =
                currentConsensusBlockNumber === this._latestPBlock.blockNumber + 1 &&
                !this.consensusCore.isConsensusRunningForBlockNumber(currentConsensusBlockNumber + 1);
            if (isPBlocksFactoryGoingToBeNotifiedOfCurrentConsensusEnd) {
                this._logger.info(
                    `PBlocksFactory is waiting to be notified when processing for current pBlock is finished (since the next block is not yet started)...`
                );
                return;
            }

            // somehow the consensus for the latestPBlock has already finished, but PBlocksFactory wasn't notified
            this._logger.warn(
                `Consensus is currently at block number ${currentConsensusBlockNumber} and the local current pBlock is at ${this._latestPBlock.blockNumber}`
            );
            this._logger.warn(`Removing _latestPBlock in order to continue consensus`, this._latestPBlock);
            this._latestPBlock = null;
        }

        const commands = this.pendingCommands.splice(0, this.maxPBlockSize);
        return this._buildPBlockFromCommands(commands);
    }

    _buildPBlockFromCommands(commands) {
        if (!commands.length) {
            throw new Error("Cannot create pBlock with no commands");
        }
        return this._buildPBlock(commands);
    }

    _buildPBlock(commands = []) {
        const latestVerifiedBlockInfo = this.consensusCore.getLatestBlockInfo();
        const blockNumber = latestVerifiedBlockInfo.number !== -1 ? latestVerifiedBlockInfo.number + 1 : 1;

        this._logger.info(`Constructing pBlock number ${blockNumber} having ${commands.length} command(s)...`);
        const pBlock = createPBlock(this.validatorDID, commands, latestVerifiedBlockInfo.hash, blockNumber);

        return pBlock;
    }

    async _sendPBlockForConsensus(pBlock) {
        this._logger.info(`Sending pBlock to consensus ${pBlock.hash}...`);
        this._latestPBlock = pBlock;

        try {
            this._logger.info(`Saving pBlock number ${pBlock.blockNumber} in bricks...`, pBlock);
            const pBlockHashLinkSSI = await savePBlockInBricks(pBlock, this.domain, this.brickStorage);
            pBlock.hashLinkSSI = pBlockHashLinkSSI;

            this.broadcaster.broadcastPBlockAdded(pBlock);

            try {
                await this.consensusCore.addInConsensusAsync(pBlock);
                this._logger.info(`Consensus finished for block number ${pBlock.blockNumber}`);
            } catch (error) {
                this._logger.error(`Consensus failed for block number ${pBlock.blockNumber}`, error);
            }

            this._latestPBlock = null;

            if (this._commandProcessing) {
                await this._commandProcessing;
            }

            const latestVerifiedBlockInfo = this.consensusCore.getLatestBlockInfo();
            const latestVerifiedBlockNumber = latestVerifiedBlockInfo.number;
            const isNextBlockAlreadyForceRequested = !!this._forceRequestedBlockNumbers[latestVerifiedBlockNumber + 1];
            if (isNextBlockAlreadyForceRequested) {
                const forceBlockNumber = latestVerifiedBlockNumber + 1;
                this._logger.info(`Block number ${forceBlockNumber} was force requested before, so trying to create it`);
                let pBlock = this._forceBuildPBlockFromAllCommands();
                if (pBlock) {
                    this._logger.debug(`Created pBlock for block number ${forceBlockNumber}`, pBlock);
                } else {
                    this._logger.debug(`Created empty pBlock for block number ${forceBlockNumber}`);
                    pBlock = this._buildPBlock();
                }

                this._sendPBlockForConsensus(pBlock);
                return;
            }

            const isPlockConstructed = this._constructPBlockIfBlockSizeRestrictionReached();
            if (!isPlockConstructed) {
                this._startBlockTimeCheckTimeout();
            }
        } catch (error) {
            this._logger.error("An error has occurred while running the consensus for pBlock", error);
        }
    }

    _constructPBlockIfBlockSizeRestrictionReached() {
        const isBlockSizeLimitReached = this.pendingCommands.length >= this.maxPBlockSize;
        if (isBlockSizeLimitReached) {
            this._logger.info(`Reached block size restriction of ${this.maxPBlockSize}`);
            const pBlock = this._buildPBlockForMaxBlockSize();
            if (pBlock) {
                this._sendPBlockForConsensus(pBlock);
                return true;
            }
        }

        return false;
    }

    _clearBlockTimeCheckTimeout() {
        if (this._blockTimeCheckTimeout) {
            clearTimeout(this._blockTimeCheckTimeout);
            this._blockTimeCheckTimeout = null;
        }
    }
}

function create(...params) {
    return new PBlocksFactory(...params);
}

module.exports = {
    create,
};
