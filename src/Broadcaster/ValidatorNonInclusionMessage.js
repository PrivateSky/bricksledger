class ValidatorNonInclusionMessage {
    constructor(body) {
        if (!body) {
            throw new Error("body must be specified");
        }

        const { validatorDID, validatorURL, blockNumber, unreachableValidators } = body;

        this.validatorDID = validatorDID;
        this.validatorURL = validatorURL;
        this.blockNumber = blockNumber;
        this.unreachableValidators = unreachableValidators;
    }

    computeHash() {
        const { validatorDID, validatorURL, blockNumber, unreachableValidators } = this;

        const objectToHash = {
            validatorDID,
            validatorURL,
            blockNumber,
            unreachableValidators,
        };

        const crypto = require("opendsu").loadApi("crypto");
        const hash = crypto.sha256(objectToHash);

        return hash;
    }

    sign(validatorDID) {
        const hash = this.computeHash();
        this.validateSignature = validatorDID.sign(hash);
    }

    async validateSignature() {
        const { validatorDID: validatorDIDIdentifier, validatorSignature } = this;

        const hash = this.computeHash();

        const w3cDID = require("opendsu").loadApi("w3cdid");
        const validatorDID = await $$.promisify(w3cDID.resolveDID)(validatorDIDIdentifier);
        const isValidSignature = await $$.promisify(validatorDID.verify)(hash, validatorSignature);

        if (!isValidSignature) {
            throw new Error("Invalid signature specified");
        }
    }

    getContent() {
        const { validatorDID, validatorURL, blockNumber, unreachableValidators, validatorSignature } = body;

        const content = {
            validatorDID,
            validatorURL,
            blockNumber,
            unreachableValidators,
            validatorSignature,
        };
        return content;
    }
}

module.exports = ValidatorNonInclusionMessage;
