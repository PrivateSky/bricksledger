/*
  Created BrickBlocks and send it to the optimistic execution 
  Save the bricks in the BrickStorage
*/

function createBrickBlock(commandsArray,hashOfThePreviousBlock,blockNumber,validatorDID){
 
  let res = {
   commandsArray,
    hashOfThePreviousBlock,
    blockNumber
  }
  res.validatorSIgnature = validatorDID.sign(hash(res));
  return res;
}

function createBlock(brickBlocksSet, votingProof, blockNumber, previousBlockHash ){
  let brickBlocksArray = sort(brickBlocksSet);
  let res = {
   brickBlocksArray,
    votingProof,
    blockNumber,
    previousBlockHash
  }
  return res;
}


module.exports = {
 createBrickBlock,
 createBlock
}
