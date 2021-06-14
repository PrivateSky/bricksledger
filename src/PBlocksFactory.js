const PBlock = require("./PBlock");

async function savePBlockInBricks(pBlock, domain, brickStorage) {
    const openDSU = require("opendsu");
    const keySSISpace = openDSU.loadApi("keyssi");

    const pBlockBrickHash = await brickStorage.addBrickAsync(pBlock);

    const hashLinkSSI = keySSISpace.createHashLinkSSI(domain, pBlockBrickHash);
    return hashLinkSSI;
}

class PBlocksFactory {
    constructor(domain, validatorDID, brickStorage, consensusCore, maxBlockSize, maxBlockTimeMs) {
        this.domain = domain;
        this.validatorDID = validatorDID;
        this.brickStorage = brickStorage;
        this.consensusCore = consensusCore;

        this.pendingCommands = [];

        if (!maxBlockSize) {
            maxBlockSize = 100;
        }
        this.maxBlockSize = maxBlockSize;

        if (!maxBlockTimeMs) {
            maxBlockTimeMs = 1000 * 60; // 1 minute
        }
        this.maxBlockTimeMs = maxBlockTimeMs;

        this._latestPBlock = null;
        this._isNextPBlockWaiting = false;

        this._startBlockTimeCheckTimeout();
    }

    addCommandForConsensus(command) {
        this.pendingCommands.push(command);

        const isBlockSizeLimitReached = this.pendingCommands.length >= this.maxBlockSize;
        if (isBlockSizeLimitReached) {
            console.log(`[PBlocksFactory] Reached block size restriction of ${this.maxBlockSize}`);
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
            console.log(`[PBlocksFactory] Reached block time restriction of ${this.maxBlockTimeMs}ms`);

            // if we have commands then contruct the pBlock because of the block time restriction has been reached
            if (this.pendingCommands.length !== 0) {
                this._buildPBlockFromCommands();
            }

            // start another timeout check
            this._startBlockTimeCheckTimeout();
        }, this.maxBlockTimeMs);
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

        const previousBlockInfo = this.consensusCore.getLatestBlockInfo();
        const commands = this.pendingCommands.splice(0, this.maxBlockSize);

        const blockNumber = previousBlockInfo.number !== -1 ? previousBlockInfo.number + 1 : 1;

        const pBlockInfo = {
            validatorDID: this.validatorDID.getIdentifier(),
            commands,
            previousBlockHash: previousBlockInfo.hash,
            blockNumber,
        };
        const pBlock = new PBlock(pBlockInfo);
        pBlock.hash = pBlock.computeHash();
        pBlock.validatorSignature = this.validatorDID.sign(pBlock.hash);

        this._latestPBlock = pBlock;

        const pBlockHashLinkSSI = await savePBlockInBricks(pBlock, this.domain, this.brickStorage);

        // todo: broadcast pBlock
        try {
            await this.consensusCore.addInConsensusAsync(pBlock, pBlockHashLinkSSI);
            this._latestPBlock = null;

            const isBlockSizeLimitReached = this.pendingCommands.length >= this.maxBlockSize;
            if (isBlockSizeLimitReached) {
                console.log(`[PBlocksFactory] Reached block size restriction of ${this.maxBlockSize}`);
                this._buildPBlockFromCommands();
            } else {
                this._startBlockTimeCheckTimeout();
            }
        } catch (error) {
            console.log("error", error);
            console.error("An error has occurred while running the consensus for pBlock");
        }
    }
}

function create(...params) {
    return new PBlocksFactory(...params);
}

module.exports = {
    create,
};
