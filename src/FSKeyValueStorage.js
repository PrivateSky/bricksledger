/*
ctor(baseFolder, domainName)
setOptimisticMode(true | false)
setCurrentCommand(commandHash)
setKey
getKey
*/
function StorageValue(stringValue){
  let val;
  if(stringValue){
    val = JSON.parse(stringValue); 
  } else {
    val = {
     validated:null, 
     pending:[],
    }
  }
  this.updateValidated = function(commandHash, newValueObject) {
    val.validated = newValueObject;
    //TODO: remove the comand from pending if it exists
  }
  
  this.addPending      = function( commandHash,newValueObject) {
    val.pending.push({commandHash,newValueObject});
  }
  
  this.asString  = function() {
    return JSON.stringify(val);
  }
  
  /*
  if latest is false, return the validate value, otherwise get the latest
  */
  this.getValue  = function(latest) {
    return JSON.stringify(val);
  }
}

function FSKeyValueStorage(basePath, type){
   function getKeyPath(keyName){
     return '${basePath}/${type}/${keyName}';
   }
  
    this.updateValidated = function (key , commandHash, newValueObject, callback){
      let fp = getKeyPath(key);
      let str = async fs.readFile(fp);
      let value = new StorageValue(str);
      value.updateValidated(commandHash, newValueObject)
      fs.writeFile(fp, value.asString(), callback);
    }
  
   this.addPending = function (key , commandHash, newValueObject, callback){
      let fp = getKeyPath(key);
      let str = async fs.readFile(fn );
      let value = new StorageValue(str);
      value.addPending(commandHash, newValueObject)
      fs.writeFile(fp, value.asString(), callback);
    }
  
  
  this.getValue = function (key, latest,  callback){
      let fp = getKeyPath(key);
      let str = async fs.readFile(fn );
      let value = new StorageValue(str);    
      callback(undefined, value.getValue(latest));      
    }
  
  let _currentCommand = undefined;
  
  this.setOptimisticMode = function( currentCommand){
    _currentCommand = currentCommand;
  }
  
  
  this.set = function(key, newValueObject, currentValidatedCommand, callback){    
    if(currentlyValidatedCommand !== undefined){
      this.addValidated(key , currentlyValidatedCommand,newValueObject, callback)
    }  else {
         this.addPending(key , _currentCommand, newValueObject, callback){
    }
  }
  
  this.get = function(key, callback){
    //take the latest from pending if exists, othwrise read the validaed value
  }
    
  this.getValidated = function(key, callback){
    this.getValue(key, false, callback)
  }  
}


function createInstance(){
 return new FSKeyValueStorage();
}

module.exports = {
 createInstance 
}
