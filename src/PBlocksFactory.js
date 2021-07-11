const Logger = require("./Logger");
const PBlock = require("./PBlock");

async function savePBlockInBricks(pBlock, domain, brickStorage) {
    const openDSU = require("opendsu");
    const keySSISpace = openDSU.loadApi("keyssi");

    const pBlockBrickHash = await brickStorage.addBrickAsync(pBlock.getSerialisation());

    const hashLinkSSI = keySSISpace.createHashLinkSSI(domain, pBlockBrickHash);
    return hashLinkSSI;
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

        this.pendingCommands.push(command);

        const isBlockSizeLimitReached = this.pendingCommands.length >= this.maxPBlockSize;
        if (isBlockSizeLimitReached) {
            this._logger.info(`Reached block size restriction of ${this.maxPBlockSize}`);
            const pBlock = this._buildPBlockForMaxBlockSize();
            if (pBlock) {
                this._sendPBlockForConsensus(pBlock);
            }
        }
    }

    // getPBlockProposedForConsensus(pBlock, callback) {
    //     callback = $$.makeSaneCallback(callback);

    //     this.getPBlockProposedForConsensusAsync(pBlock)
    //         .then((result) => callback(undefined, result))
    //         .catch((error) => callback(error));
    // }

    // async getPBlockProposedForConsensusAsync(blockNumber, validatorDID) {
    //     this._logger.info(
    //         `Getting pBlock proprosed for consensus by validator '${validatorDID}' for block number ${blockNumber}...`
    //     );
    //     const latestVerifiedBlockInfo = this.consensusCore.getLatestBlockInfo();
    //     const currentConsensusBlockNumber = latestVerifiedBlockInfo.number + 1;

    //     if (this._latestPBlock) {
    //         // checking which is the latest pBlock which is awaiting consensus
    //         const currentBlockNumber = this._latestPBlock.blockNumber;
    //         if (blockNumber <= currentBlockNumber) {
    //             this._logger.info(
    //                 `Wanting to get pBlock proposed for consensus for block number ${blockNumber} but consensus is already at block number ${currentBlockNumber}`
    //             );
    //             throw new Error(`pBlock proposed for consensus is already at block ${currentBlockNumber}`);
    //         }

    //         const isCurrentlyWaitingForLatestBlockConsensus = currentBlockNumber === blockNumber;
    //         if (isCurrentlyWaitingForLatestBlockConsensus) {
    //             return JSON.parse(this._latestPBlock.getSerialisation());
    //         }

    //         this._logger.info(
    //             `Wanting to get pBlock proposed for consensus for block number ${blockNumber} but latest pBlock is older (at block number ${currentBlockNumber})`
    //         );

    //         const needToCreateNewPBlock = currentBlockNumber < latestVerifiedBlockInfo.number;
    //         if (needToCreateNewPBlock) {
    //             this._logger.info(
    //                 `Latest pBlock (at block number ${currentBlockNumber}) is older than current consensus cycle (${currentConsensusBlockNumber})`
    //             );
    //         }
    //     } else {
    //         needToCreateNewPBlock = blockNumber === currentConsensusBlockNumber;
    //     }

    //     if (needToCreateNewPBlock) {
    //         const pBlock = this._forceBuildPBlockFromAllCommands();
    //         if (pBlock) {
    //             this._sendPBlockForConsensus(pBlock);
    //         }

    //         return pBlock;
    //     }

    //     const errorMessage = `Requesting a proposed pBlock for block ${blockNumber} but consensus is running block ${currentConsensusBlockNumber}`;
    //     this._logger.warn(errorMessage);
    //     throw new Error(errorMessage);
    // }

    _startBlockTimeCheckTimeout() {
        if (this._blockTimeCheckTimeout) {
            clearTimeout(this._blockTimeCheckTimeout);
        }
        this._blockTimeCheckTimeout = setTimeout(async () => {
            this._logger.info(`Reached block time restriction of ${this.maxPBlockTimeMs}ms`);

            // if we have commands then contruct the pBlock because of the block time restriction has been reached
            if (this.pendingCommands.length !== 0) {
                const pBlock = this._buildPBlockForMaxBlockSize();
                if (pBlock) {
                    this._sendPBlockForConsensus(pBlock);
                }
            }

            // start another timeout check
            this._startBlockTimeCheckTimeout();
        }, this.maxPBlockTimeMs);
    }

    _forceBuildPBlockFromAllCommands() {
        if (!this.consensusCore.isRunning()) {
            throw new Error("Cannot build PBlock due to consensus not running");
        }

        const commands = this.pendingCommands.splice(0, this.pendingCommands.length);
        return this._buildPBlockFromCommands(commands);
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
                `Consensus is currently at block number ${currentConsensusBlockNumber} and the local current pBlock is at ${this._latestPBlock.number}`
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

        const latestVerifiedBlockInfo = this.consensusCore.getLatestBlockInfo();

        const blockNumber = latestVerifiedBlockInfo.number !== -1 ? latestVerifiedBlockInfo.number + 1 : 1;

        this._logger.info(`Constructing pBlock number ${blockNumber} having ${commands.length} command(s)...`);
        const pBlock = createPBlock(this.validatorDID, commands, latestVerifiedBlockInfo.hash, blockNumber);

        return pBlock;
    }

    async _sendPBlockForConsensus(pBlock) {
        this._logger.info(`Sending pBlock to consensus ${pBlock.hash}...`);
        this._latestPBlock = pBlock;
        this.broadcaster.broadcastPBlockAdded(pBlock);

        try {
            this._logger.info(`Saving pBlock number ${pBlock.blockNumber} in bricks...`, typeof pBlock);
            const pBlockHashLinkSSI = await savePBlockInBricks(pBlock, this.domain, this.brickStorage);
            pBlock.hashLinkSSI = pBlockHashLinkSSI;

            await this.consensusCore.addInConsensusAsync(pBlock);
            this._latestPBlock = null;

            const isBlockSizeLimitReached = this.pendingCommands.length >= this.maxPBlockSize;
            if (isBlockSizeLimitReached) {
                this._logger.info(`Reached block size restriction of ${this.maxPBlockSize}...`);
                const pBlock = this._buildPBlockForMaxBlockSize();
                this._sendPBlockForConsensus(pBlock);
            } else {
                this._startBlockTimeCheckTimeout();
            }
        } catch (error) {
            this._logger.error("An error has occurred while running the consensus for pBlock", error);
        }
    }
}

function create(...params) {
    return new PBlocksFactory(...params);
}

module.exports = {
    create,
};
