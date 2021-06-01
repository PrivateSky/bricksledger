function BricksLedger(booter, bbFactory,  broadcaster, consensusCore, executionEngine, bricksStorage, keyValueStorage){
  
  this.newCommand = function(){
    
  }
  
  
  this.newBlock = function(){
    
  }
  
}

module.exports.initiliseBrickLedger = function(domain){
  let bricksStorage   = require("./src/FSBricksStorage.js").create(domain); 
  let keyValueStorage = require("./src/FSKeyValueStorage.js").create(domain); 
  let bbFactory       = require("./src/BrickBlocksFactory.js").create(domain);
  let executionEngine = require("./src/ExecutionEngine.js").create(domain);
  let consensusCore   = require("./src/ConsensusCore.js").create(domain);
  let broadcaster     = require("./src/broadcaster.js").create(domain); 
  
  let booter          = require("./src/booter.js").create(domain); 
  
  return new BricksLedger(bbFactory,  broadcaster, consensusCore, executionEngine, bricksStorage, keyValueStorage);
}

// if required, we could open the APIs later to customise these standard components
