class PBlockBuilder {
    constructor(validatorDID, commands, previousBlockHash, blockNumber, validatorSignature) {
        this.validatorDID = validatorDID;
        this.commands = commands;
        this.previousBlockHash = previousBlockHash;
        this.blockNumber = blockNumber;
        this.validatorSignature = validatorSignature;
    }

    build() {
        const { validatorDID, commands, previousBlockHash, blockNumber } = this;
        const pBlock = {
            validatorDID: validatorDID.getIdentifier(),
            commands,
            previousBlockHash,
            blockNumber,
        };

        const crypto = require("opendsu").loadApi("crypto");
        const hash = crypto.sha256(pBlock);

        pBlock.hash = hash;
        pBlock.validatorSignature = validatorDID.sign(hash);

        return pBlock;
    }
}

class PBlocksFactory {
    constructor(domain, validatorDID, consensusCore, maxBlockSize, maxBlockTimeMs) {
        this.domain = domain;
        this.validatorDID = validatorDID;
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
        const pBlockBuilder = new PBlockBuilder(this.validatorDID, commands, previousBlockInfo.hash, blockNumber);

        const pBlock = pBlockBuilder.build();
        this._latestPBlock = pBlock;

        // todo: broadcast pBlock
        try {
            await $$.promisify(this.consensusCore.addInConsensus)(pBlock);
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

function create(...args) {
    return new PBlocksFactory(...args);
}

module.exports = {
    create,
};
