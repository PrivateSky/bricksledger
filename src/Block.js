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
}

module.exports = Block;
