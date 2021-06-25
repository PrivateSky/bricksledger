class Block {
    constructor(block) {
        if (!block) {
            throw "Block must be specified";
        }

        const { pbs, blockNumber, previousBlock, hashLinkSSI } = block;
        this.block = block;
        this.pbs = pbs;
        this.blockNumber = blockNumber;
        this.previousBlock = previousBlock;
        this.hashLinkSSI = hashLinkSSI;
    }

    getSerialisation(){
        return JSON.stringify(this.block);
    }
}

module.exports = Block;
