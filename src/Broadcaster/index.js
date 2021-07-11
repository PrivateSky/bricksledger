const Logger = require("../Logger");
const PBlockAddedMessage = require("./PBlockAddedMessage");
const ValidatorNonInclusionMessage = require("./ValidatorNonInclusionMessage");
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

    broadcastPBlockAdded(pBlock) {
        const { validatorDID, validatorURL } = this;
        const { blockNumber, hashLinkSSI } = pBlock;
        const message = new PBlockAddedMessage({
            validatorDID: validatorDID.getIdentifier(),
            validatorURL,
            blockNumber,
            pBlockHashLinkSSI: hashLinkSSI,
        });
        this._broadcastMessageToAllValidatorsExceptSelf("pblock-added", message.getContent());
    }

    broadcastValidatorNonInclusion(blockNumber, unreachableValidators) {
        const { validatorDID, validatorURL } = this;
        const message = new ValidatorNonInclusionMessage({
            validatorDID: validatorDID.getIdentifier(),
            validatorURL,
            blockNumber,
            unreachableValidators,
        });
        this._broadcastMessageToAllValidatorsExceptSelf("block-unreachable-validators", message.getContent());
    }

    async _broadcastMessageToAllValidatorsExceptSelf(endpointSuffix, message) {
        const validators = getValidatorsForCurrentDomain(this.executionEngine);
        if (!validators || !validators.length) {
            this._logger.info("[Broadcaster] No validators found for current domain");
            return;
        }

        const validatorsToBroadcastTo = validators.filter((validator) => validator.DID !== pBlock.validatorDID);
        this._logger.info(
            `Broadcasting message '${JSON.stringify(message)}' to ${validatorsToBroadcastTo.length} validator(s)...`
        );

        validatorsToBroadcastTo.forEach((validator) => this._broadcastMessageToValidator(validator, endpointSuffix, message));
    }

    async _broadcastMessageToValidator(validator, endpointSuffix, message) {
        const { doPost } = require("opendsu").loadApi("http");
        const { DID, URL } = validator;

        const broadcastUrl = `${URL}/contracts/${this.domain}/${endpointSuffix}`;
        try {
            const response = await $$.promisify(doPost)(broadcastUrl, message);
            this._logger.debug(`Broadcasted to ${endpointSuffix} to validator ${DID} at ${URL}`, response);
        } catch (error) {
            this._logger.debug(`Failed to broadcast to ${endpointSuffix} to validator ${DID} at ${URL}`, error);
        }
    }
}

function create(...params) {
    return new Broadcaster(...params);
}

module.exports = {
    create,
};
