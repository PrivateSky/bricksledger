/*
  Created BrickBlocks and send it to the optimistic execution 
  Save the bricks in the BrickStorage
*/

class PBlocksFactory {
    constructor(domain) {
        this.domain = domain;
    }

    addCommandForConsensus(command) {}

    createPBlock(commandsArray, hashOfThePreviousBlock, blockNumber, validatorDID) {
        let res = {
            commandsArray,
            hashOfThePreviousBlock,
            blockNumber,
        };
        res.validatorSIgnature = validatorDID.sign(hash(res));
        return res;
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
}

function create(domain) {
    return new PBlocksFactory(domain);
}

module.exports = {
    create,
};
