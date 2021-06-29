const ValidatorContractExecutor = require("./ValidatorContractExecutor");

function create(...params) {
    return new ValidatorContractExecutor(...params);
}

module.exports = {
    create
}