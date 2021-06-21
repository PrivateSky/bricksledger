class PBlock {
    constructor(pBlock) {
        if (!pBlock) {
            throw "pBlock must be specified";
        }

        const { validatorDID, commands, previousBlockHash, blockNumber, hash, validatorSignature, hashLinkSSI } = pBlock;

        this.validatorDID = validatorDID;
        this.commands = commands;
        this.previousBlockHash = previousBlockHash;
        this.blockNumber = blockNumber;
        this.hash = hash;
        this.validatorSignature = validatorSignature;
        this.hashLinkSSI = hashLinkSSI;
    }

    computeHash() {
        const { commands, previousBlockHash, blockNumber } = this;

        const objectToHash = {
            commands,
            previousBlockHash,
            blockNumber,
        };

        const crypto = require("opendsu").loadApi("crypto");
        const hash = crypto.sha256(objectToHash);

        return hash;
    }

    async validateSignature() {
        const { validatorDID: validatorDIDIdentifier, validatorSignature } = this;

        const hash = this.computeHash();

        const w3cDID = require("opendsu").loadApi("w3cdid");
        const validatorDID = await $$.promisify(w3cDID.resolveDID)(validatorDIDIdentifier);
        const isValidSignature = await $$.promisify(validatorDID.verify)(hash, validatorSignature);

        if (!isValidSignature) {
            throw "Invalid signature specified";
        }
    }
}

module.exports = PBlock;
