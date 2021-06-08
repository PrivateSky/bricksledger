/*
A configurable consensus core that can have 3 consensus strategies
 - SVBC - Single Validator BrickLedger Consensus:  Only one node is accepting commands and propose BrickBlocks. A block has only one BrickBlock.
 - MVBC - Multiple Validators BrickLedger Consensus: run the BrickLedger consensus between validators
 - OBAC - Other Blockchain Adapter Consensus: Delegates Consensus to a blockchain adapter that is using other blockchain network for consensus regrading the blocks of commands 
*/
class ConsensusCore {
    constructor(domain, executionEngine) {
        this.domain = domain;
        this.executionEngine = executionEngine;
        this.latestBlockNumber = 0;
        this.latestBlockHash = null;
    }

    addInConsensus(pBlock, callback) {
        // validate pBlock

        setTimeout(async () => {
            try {
                await this.executionEngine.executePBlock(pBlock);
                callback();
            } catch (error) {
                console.error("Error while executing pBlock", error);
                callback(error);
            }
        }, 1000);
    }

    getLatestBlockInfo() {
        return {
            number: this.latestBlockNumber,
            hash: this.latestBlockHash,
        };
    }
}

function create(domain) {
    return new ConsensusCore(domain);
}

module.exports = {
    create,
};
