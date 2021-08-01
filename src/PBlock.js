const Command = require("./Command");

class PBlock {
    constructor(pBlock, onConsensusFinished) {
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
        this.onConsensusFinished = onConsensusFinished;
        this.isEmpty = !commands || !commands.length;
    }

    sign(validatorDID) {
        this.hash = this.computeHash();
        this.validatorSignature = validatorDID.sign(this.hash);
    }

    computeHash() {
        const { previousBlockHash, blockNumber } = this;
        const commands = this.getCommandsForSerialisation();

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
            throw "Invalid signature specified for PBlock";
        }
    }

    getSerialisation() {
        const { validatorDID, previousBlockHash, blockNumber, hash, validatorSignature, hashLinkSSI } = this;
        const commands = this.getCommandsForSerialisation();
        const pBlock = { validatorDID, commands, previousBlockHash, blockNumber, hash, validatorSignature, hashLinkSSI };
        return JSON.stringify(pBlock);
    }

    getCommandsForSerialisation() {
        let commands = this.commands;
        if (commands) {
            commands = commands.map((command) => (command instanceof Command ? command.getForSerialisation() : command));
        }
        return commands;
    }
}

module.exports = PBlock;
