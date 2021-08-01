const Logger = require("./Logger");

class Notifier {
    constructor(domain, validatorDID) {
        this.domain = domain;
        this.validatorDID = validatorDID;

        this._logger = new Logger(`[Bricksledger][${this.domain}][${this.validatorDID.getIdentifier()}][Notifier]`);
        this._logger.info("Create finished");
    }

    notifyNewBlock(blockInfo) {
        const openDSU = require("opendsu");
        const notificationsApi = openDSU.loadApi("notifications");

        const validatorSSI = {
            getDLDomain: () => this.domain,
            getAnchorId: () => this.validatorDID.getIdentifier(),
        };

        const message = {
            type: "newBlock",
            payload: blockInfo,
        };

        this._logger.debug(`Publishing new block notification: ${JSON.stringify(message)}...`);
        notificationsApi.publish(validatorSSI, message, (error, response) => {
            if (error) {
                return this._logger.error(`Failed to publish new block notification`, error);
            }
            this._logger.debug(`Received new block notification response`, response);
        });
    }
}

function create(...params) {
    return new Notifier(...params);
}

module.exports = {
    create,
};
