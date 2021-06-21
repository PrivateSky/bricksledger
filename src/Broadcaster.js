const { getValidatorsForCurrentDomain } = require("./utils/bdns-utils");

async function broadcastPBlockToValidator(domain, validator, pBlock) {
    const { doPost } = require("opendsu").loadApi("http");
    const { DID, URL } = validator;

    const broadcastUrl = `${URL}/contracts/${domain}/validate`;
    const broadcastBody = {
        validatorDID: DID,
        validatorURL: URL,
        pBlockHashLinkSSI: pBlock.hashLinkSSI,
    };
    try {
        const response = await $$.promisify(doPost)(broadcastUrl, broadcastBody);
        console.log("[Broadcaster] Received validator response", response);
    } catch (error) {
        console.log(`[Broadcaster] Failed to broadcast to validator ${DID} at ${URL}`, error);
    }
}

class Broadcaster {
    constructor(domain, validatorDID, executionEngine) {
        this.domain = domain;
        this.validatorDID = validatorDID;
        this.executionEngine = executionEngine;
    }

    broadcastPBlock(pBlock) {
        const validators = getValidatorsForCurrentDomain(this.executionEngine);
        if (!validators || !validators.length) {
            console.log("[Broadcaster] No validators found for current domain");
            return;
        }

        // we must broadcast to the validators configured for the current domain, except to the validator or the pBlock
        const validatorsToBroadcastTo = validators.filter((validator) => validator.DID !== pBlock.validatorDID);
        validatorsToBroadcastTo.forEach((validator) => broadcastPBlockToValidator(this.domain, validator, pBlock));
    }
}

function create(...params) {
    return new Broadcaster(...params);
}

module.exports = {
    create,
};
