const Logger = require("../Logger");
const PBlockAddedMessage = require("./PBlockAddedMessage");
const { getValidatorsForCurrentDomain } = require("../utils/bdns-utils");

class Broadcaster {
    constructor(domain, validatorDID, validatorURL, executionEngine) {
        this.domain = domain;
        this.validatorDID = validatorDID;
        this.validatorURL = validatorURL;
        this.executionEngine = executionEngine;

        this._logger = new Logger(`[Bricksledger][${this.domain}][${this.validatorDID.getIdentifier()}][Broadcaster]`);
        this._logger.info("Create finished");
    }

    broadcastPBlock(pBlock) {
        const validators = getValidatorsForCurrentDomain(this.executionEngine);
        if (!validators || !validators.length) {
            console.log("[Broadcaster] No validators found for current domain");
            return;
        }

        const { validatorDID, validatorURL } = this;
        const { blockNumber, hashLinkSSI } = pBlock;
        const pBlockAddedMessage = new PBlockAddedMessage({
            validatorDID,
            validatorURL,
            blockNumber,
            pBlockHashLinkSSI: hashLinkSSI,
        });
        const messageToBroadcast = pBlockAddedMessage.getContent();

        // we must broadcast to the validators configured for the current domain, except to the validator or the pBlock
        const validatorsToBroadcastTo = validators.filter((validator) => validator.DID !== pBlock.validatorDID);
        this._logger.info(`Broadcasting pBlockAdded to ${validatorsToBroadcastTo.length} validator(s)...`);

        validatorsToBroadcastTo.forEach((validator) => this._broadcastPBlockToValidator(validator, messageToBroadcast));
    }

    async _broadcastPBlockToValidator(validator, message) {
        const { doPost } = require("opendsu").loadApi("http");
        const { DID, URL } = validator;

        const broadcastUrl = `${URL}/contracts/${this.domain}/pblock-added`;
        try {
            const response = await $$.promisify(doPost)(broadcastUrl, message);
            this._logger.info("[Broadcaster] Broadcasted pBlockAdded to validator ${DID} at ${URL}", response);
        } catch (error) {
            this._logger.info(`[Broadcaster] Failed to broadcast pBlockAdded to validator ${DID} at ${URL}`, error);
        }
    }
}

function create(...params) {
    return new Broadcaster(...params);
}

module.exports = {
    create,
};
