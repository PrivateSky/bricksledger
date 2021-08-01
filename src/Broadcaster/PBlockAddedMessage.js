class PBlockAddedMessage {
    constructor(body) {
        if (!body) {
            throw new Error("body must be specified");
        }

        const { validatorDID, validatorURL, blockNumber, pBlockHashLinkSSI, validatorSignature } = body;

        this.validatorDID = validatorDID;
        this.validatorURL = validatorURL;
        this.blockNumber = blockNumber;
        this.pBlockHashLinkSSI = pBlockHashLinkSSI;
        this.validatorSignature = validatorSignature;
    }

    computeHash() {
        const { validatorDID, validatorURL, blockNumber, pBlockHashLinkSSI } = this;

        const objectToHash = {
            validatorDID,
            validatorURL,
            blockNumber,
            pBlockHashLinkSSI,
        };

        const crypto = require("opendsu").loadApi("crypto");
        const hash = crypto.sha256(objectToHash);

        return hash;
    }

    sign(validatorDID) {
        const hash = this.computeHash();
        this.validatorSignature = validatorDID.sign(hash);
    }

    async validateSignature() {
        const { validatorDID: validatorDIDIdentifier, validatorSignature } = this;

        const hash = this.computeHash();

        const w3cDID = require("opendsu").loadApi("w3cdid");
        const validatorDID = await $$.promisify(w3cDID.resolveDID)(validatorDIDIdentifier);
        const isValidSignature = await $$.promisify(validatorDID.verify)(hash, validatorSignature);

        if (!isValidSignature) {
            throw new Error("Invalid signature specified for PBlockAddedMessage");
        }
    }

    getContent() {
        const { validatorDID, validatorURL, blockNumber, pBlockHashLinkSSI, validatorSignature } = this;

        const content = {
            validatorDID,
            validatorURL,
            blockNumber,
            pBlockHashLinkSSI,
            validatorSignature,
            hash: this.computeHash(),
        };
        return content;
    }
}

module.exports = PBlockAddedMessage;
