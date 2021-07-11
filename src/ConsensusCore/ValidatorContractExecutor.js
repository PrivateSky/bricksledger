const Logger = require("../Logger");

class ValidatorContractExecutor {
    constructor(domain, validatorDID, validatorURL) {
        this._domain = domain;
        this._validatorDID = validatorDID;
        this._validatorURL = validatorURL;
        this._logger = new Logger(`[Bricksledger][${domain}][${this._validatorDID}][ValidatorContractExecutor]`);
    }

    async getValidatorsAsync() {
        return await this._callSafeCommand("bdns", "getDomainValidators");
    }

    async getLatestBlockInfoAsync() {
        return await this._callSafeCommand("consensus", "getLatestBlockInfo");
    }

    async getBlockAsync(blockHashLinkSSI) {
        return await this._callSafeCommand("consensus", "getBlock", [blockHashLinkSSI]);
    }

    async getPBlockAsync(pBlockHashLinkSSI) {
        return await this._callSafeCommand("consensus", "getPBlock", [pBlockHashLinkSSI]);
    }

    async getPBlockProposedByValidatorAsync(blockNumber, validatorDID) {
        return await this._callSafeCommand("consensus", "getPBlockProposedByValidator", [blockNumber, validatorDID]);
    }

    async proposeValidatorAsync(proposedValidator) {
        await this._callNoncedCommand("bdns", "addDomainValidator", [proposedValidator]);
    }

    async _callSafeCommand(contractName, methodName, params) {
        const opendsu = require("opendsu");
        const contractsApi = opendsu.loadApi("contracts");

        const generateSafeCommand = $$.promisify(contractsApi.generateSafeCommandForSpecificServer);

        const paramsString = typeof params === "object" ? JSON.stringify(params) : params;
        const callDebugInfo = `validator '${this._validatorDID}'s contract '${contractName}' - safe - '${methodName}' - params: ${paramsString}`;
        this._logger.debug(`Calling ${callDebugInfo}`);

        try {
            const result = await generateSafeCommand(this._validatorURL, this._domain, contractName, methodName, params);
            this._logger.debug(`Calling validator ${callDebugInfo} responded with:`, result);

            return result;
        } catch (error) {
            this._logger.debug(`Calling validator ${callDebugInfo} failed with:`, error);
        }
    }

    async _callNoncedCommand(contractName, methodName, params) {
        const opendsu = require("opendsu");
        const contractsApi = opendsu.loadApi("contracts");

        const generateNoncedCommand = $$.promisify(contractsApi.generateNoncedCommandForSpecificServer);

        const paramsString = typeof params === "object" ? JSON.stringify(params) : params;
        const callDebugInfo = `validator '${this._validatorDID}'s contract '${contractName}' - nonced - '${methodName}' - params: ${paramsString}`;
        this._logger.debug(`Calling ${callDebugInfo}`);

        try {
            const result = await generateNoncedCommand(
                this._validatorURL,
                this._validatorDID,
                this._domain,
                contractName,
                methodName,
                params
            );
            this._logger.debug(`Calling validator ${callDebugInfo} responded with:`, result);

            return result;
        } catch (error) {
            this._logger.debug(`Calling validator ${callDebugInfo} failed with:`, error);
        }
    }
}

module.exports = ValidatorContractExecutor;
