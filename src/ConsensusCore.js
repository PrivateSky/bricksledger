/*
A configurable consensus core that can have 3 consensus strategies
 - SVBC - Single Validator BrickLedger Consensus:  Only one node is accepting commands and propose BrickBlocks. A block has only one BrickBlock.
 - MVBC - Multiple Validators BrickLedger Consensus: run the BrickLedger consensus between validators
 - OBAC - Other Blockchain Adapter Consensus: Delegates Consensus to a blockchain adapter that is using other blockchain network for consensus regrading the blocks of commands 
*/
class ConsensusCore {
    constructor(domain) {
        this.domain = domain;
    }

    addInConsensus(pBlock) {}
}

function create(domain) {
    return new ConsensusCore(domain);
}

module.exports = {
    create,
};
