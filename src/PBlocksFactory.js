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

                    this._logger.debug(
                        `Latest pBlock (block number ${currentBlockNumber}) is older than requested forced creation for number ${blockNumber}, so creating it`
                    );
                }

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

                this._logger.info("Previous PBlock not yet accepted. Waiting for it to finished before creating another...");
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

            await this.consensusCore.addInConsensusAsync(pBlock);
            this._latestPBlock = null;

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
