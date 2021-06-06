class Command {
    constructor(command) {
        if (!command) {
            throw "command must be specified";
        }

        this.command = command;
        const { domain, contractName, methodName, params, type, timestamp, requesterSignature, signerDID } = command;

        this.domain = domain;
        this.contractName = contractName;
        this.methodName = methodName;
        this.params = params;
        this.type = type;
        this.timestamp = timestamp;
        this.requesterSignature = requesterSignature;
        this.signerDID = signerDID;
    }

    getHash() {
        const { domain, contractName, methodName, params, type, timestamp } = this;

        const objectToHash = {
            domain,
            contractName,
            methodName,
            params,
        };

        if (type === "nonced") {
            objectToHash.timestamp = timestamp;
        }

        const pskcrypto = require("pskcrypto");
        const hashBuffer = pskcrypto.objectHash("sha256", objectToHash);
        const hash = pskcrypto.pskBase58Encode(hashBuffer);

        return hash;
    }

    async validateSignature() {
        const { signerDID: signerDIDIdentifier, requesterSignature } = this;

        const hash = this.getHash();

        const w3cDID = require("opendsu").loadApi("w3cdid");
        const signerDID = await $$.promisify(w3cDID.resolveDID)(signerDIDIdentifier);
        const isValidSignature = await $$.promisify(signerDID.verify)(hash, requesterSignature);

        if (!isValidSignature) {
            throw "Invalid signature specified";
        }
    }
}

module.exports = Command;
