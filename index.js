function BricksLedger(myDID, booter, bbFactory,  broadcaster, consensusCore, executionEngine, bricksStorage, keyValueStorage){
  
  this.executeSafeCommand = function(command, callback){
    let executionResult = await executionEngine.executeMethodOptimistcally(command);
    if(execution.requireConsensus()){
      this.executeNoncedCommand(command, callback);
    }
    callback(undefined, executionResult)
  }
  
  this.executeNoncedCommand = function(command, callback){
    if(booter.contracts.bdns.isValidator(myDID)){
      bbFactory.addNoncedCommand(command);
    } else {
      let validator = async booter.contracts.bdns.chooseValidator();
      broadcaster.forwardCommand(validator, command, callback);  //pass the command to an real validator
    }      
  }
    
  this.newBrickBlockFromNetwork = function(brickBlock){
    consensusCore.addInConsensus(brickBlock);
  }
  
}

module.exports.initiliseBrickLedger = function(domain, config, notificationHandler){
  let booter          = require("./src/booter.js").create(domain, config); 
  
  let bricksStorage   = require("./src/FSBricksStorage.js").create(domain,config); 
  let keyValueStorage = require("./src/FSKeyValueStorage.js").create(domain, config); 
  let bbFactory       = require("./src/BrickBlocksFactory.js").create(domain);
  let executionEngine = require("./src/ExecutionEngine.js").create(domain, notificationHandler);
  let consensusCore   = require("./src/ConsensusCore.js").create(domain);
  let broadcaster     = require("./src/broadcaster.js").create(domain); 
   
  
  return new BricksLedger(bbFactory,  broadcaster, consensusCore, executionEngine, bricksStorage, keyValueStorage);
}

// if required, we could open the APIs later to customise these standard components
