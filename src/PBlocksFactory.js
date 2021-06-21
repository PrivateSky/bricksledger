const PBlock = require("./PBlock");

async function savePBlockInBricks(pBlock, domain, brickStorage) {
    const openDSU = require("opendsu");
    const keySSISpace = openDSU.loadApi("keyssi");

    const pBlockBrickHash = await brickStorage.addBrickAsync(pBlock);

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
    pBlock.hash = pBlock.computeHash();
    pBlock.validatorSignature = validatorDID.sign(pBlock.hash);

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
        this._isNextPBlockWaiting = false;

        this._startBlockTimeCheckTimeout();
    }

    addCommandForConsensus(command) {
        console.log(`[PBlocksFactory] Added command for consensus with hash ${command.getHash()}`, this.maxPBlockSize);

        this.pendingCommands.push(command);

        const isBlockSizeLimitReached = this.pendingCommands.length >= this.maxPBlockSize;
        if (isBlockSizeLimitReached) {
            console.log(`[PBlocksFactory] Reached block size restriction of ${this.maxPBlockSize}`);
            this._buildPBlockFromCommands();
        }
    }

    createBlock(brickBlocksSet, votingProof, blockNumber, previousBlockHash) {
        let brickBlocksArray = sort(brickBlocksSet);
        let res = {
            brickBlocksArray,
            votingProof,
            blockNumber,
            previousBlockHash,
        };
        return res;
    }

    _startBlockTimeCheckTimeout() {
        if (this._blockTimeCheckTimeout) {
            clearTimeout(this._blockTimeCheckTimeout);
        }
        this._blockTimeCheckTimeout = setTimeout(() => {
            console.log(`[PBlocksFactory] Reached block time restriction of ${this.maxPBlockTimeMs}ms`);

            // if we have commands then contruct the pBlock because of the block time restriction has been reached
            if (this.pendingCommands.length !== 0) {
                this._buildPBlockFromCommands();
            }

            // start another timeout check
            this._startBlockTimeCheckTimeout();
        }, this.maxPBlockTimeMs);
    }

    async _buildPBlockFromCommands() {
        if (this._latestPBlock) {
            console.log(
                "[PBlocksFactory] Previous PBlock not yet accepted. Waiting for it to finished before creating another..."
            );
            // the previous block hasn't been confirmed yet,
            // so we must wait until it's finished before constructing the next one
            this._isNextPBlockWaiting = true;
            return;
        }

        const commands = this.pendingCommands.splice(0, this.maxPBlockSize);
        const previousBlockInfo = this.consensusCore.getLatestBlockInfo();
        const blockNumber = previousBlockInfo.number !== -1 ? previousBlockInfo.number + 1 : 1;

        const pBlock = createPBlock(this.validatorDID, commands, previousBlockInfo.hash, blockNumber);
        this._latestPBlock = pBlock;

        const pBlockHashLinkSSI = await savePBlockInBricks(pBlock, this.domain, this.brickStorage);
        pBlock.hashLinkSSI = pBlockHashLinkSSI;

        this.broadcaster.broadcastPBlock(pBlock);

        try {
            await this.consensusCore.addInConsensusAsync(pBlock);
            this._latestPBlock = null;

            const isBlockSizeLimitReached = this.pendingCommands.length >= this.maxPBlockSize;
            if (isBlockSizeLimitReached) {
                console.log(`[PBlocksFactory] Reached block size restriction of ${this.maxPBlockSize}`);
                this._buildPBlockFromCommands();
            } else {
                this._startBlockTimeCheckTimeout();
            }
        } catch (error) {
            console.error("[PBlocksFactory] An error has occurred while running the consensus for pBlock", error);
        }
    }
}

function create(...params) {
    return new PBlocksFactory(...params);
}

module.exports = {
    create,
};
