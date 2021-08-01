class Command {
    constructor(command) {
        if (!command) {
            throw "command must be specified";
        }

        const { domain, contractName, methodName, params, type, blockNumber, timestamp, requesterSignature, signerDID } = command;

        this.domain = domain;
        this.contractName = contractName;
        this.methodName = methodName;
        this.params = params;
        this.type = type;
        this.blockNumber = blockNumber;
        this.timestamp = timestamp;
        this.requesterSignature = requesterSignature;
        this.signerDID = signerDID;
    }

    getHash() {
        const { domain, contractName, methodName, params, type, blockNumber, timestamp } = this;

        const objectToHash = {
            domain,
            contractName,
            methodName,
            params,
        };

        if (type === "nonced") {
            objectToHash.blockNumber = blockNumber;
            objectToHash.timestamp = timestamp;
        }

        const crypto = require("opendsu").loadApi("crypto");
        const hash = crypto.sha256(objectToHash);

        return hash;
    }

    async validateSignature() {
        const { signerDID: signerDIDIdentifier, requesterSignature } = this;

        const hash = this.getHash();

        const w3cDID = require("opendsu").loadApi("w3cdid");
        const signerDID = await $$.promisify(w3cDID.resolveDID)(signerDIDIdentifier);
        const isValidSignature = await $$.promisify(signerDID.verify)(hash, requesterSignature);

        if (!isValidSignature) {
            throw "Invalid signature specified for Command";
        }
    }

    getForSerialisation() {
        const { domain, contractName, methodName, params, type } = this;
        return {
            domain,
            contractName,
            methodName,
            params,
            type,
        };
    }
}

module.exports = Command;
