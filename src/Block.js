class Block {
    constructor(block) {
        if (!block) {
            throw "Block must be specified";
        }

        const { pbs, blockNumber, previousBlock, hashLinkSSI } = block;
        this.pbs = pbs;
        this.blockNumber = blockNumber;
        this.previousBlock = previousBlock;
        this.hashLinkSSI = hashLinkSSI;
    }

    getSerialisation() {
        const { pbs, blockNumber, previousBlock, hashLinkSSI } = this;
        const block = { pbs, blockNumber, previousBlock, hashLinkSSI };
        return JSON.stringify(block);
    }
}

module.exports = Block;
