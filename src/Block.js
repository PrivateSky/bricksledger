class Block {
    constructor(block) {
        if (!block) {
            throw "Block must be specified";
        }

        const { pbs, blockNumber, previousBlock } = block;
        this.pbs = pbs;
        this.blockNumber = blockNumber;
        this.previousBlock = previousBlock;
    }

    getSerialisation() {
        const { pbs, blockNumber, previousBlock } = this;
        const block = { pbs, blockNumber, previousBlock };
        return JSON.stringify(block);
    }
}

module.exports = Block;
