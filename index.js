const Command = require("./src/Command");
const Logger = require("./src/Logger");
const PBlockAddedMessage = require("./src/Broadcaster/PBlockAddedMessage");
const ValidatorNonInclusionMessage = require("./src/Broadcaster/ValidatorNonInclusionMessage");

const NOT_BOOTED_ERROR = "BricksLedger not booted";

function BricksLedger(
    domain,
    validatorDID,
    pBlocksFactory,
    broadcaster,
    consensusCore,
    executionEngine,
    brickStorage,
    commandHistoryStorage
) {
    const logger = new Logger(`[Bricksledger][${domain}][${validatorDID.getIdentifier()}]`);
    let isBootFinished = false;

    this.boot = async function () {
        logger.info("Booting BricksLedger...");
        await executionEngine.loadContracts(consensusCore);
        await consensusCore.boot();
        isBootFinished = true;
        logger.info("Booting BricksLedger finished...");
    };

    this.getLatestBlockInfo = function (callback) {
        if (!isBootFinished) {
            return callback(new Error(NOT_BOOTED_ERROR));
        }
        const lastestBlockInfo = consensusCore.getLatestBlockInfo();
        callback(undefined, lastestBlockInfo);
    };

    this.executeSafeCommand = async function (command, callback) {
        callback = $$.makeSaneCallback(callback);
        logger.debug(`Received safe command ${command.getHash()}`);

        if (!isBootFinished) {
            return callback(new Error(NOT_BOOTED_ERROR));
        }

        if (!command || !(command instanceof Command)) {
            return callback("command not instance of Command");
        }

        try {
            await executionEngine.validateSafeCommand(command);

            logger.debug(`[safe-command-${command.getHash()}] executing method optimistically...`);
            let execution = executionEngine.executeMethodOptimistically(command);

            try {
                callback(undefined, execution);
            } catch (error) {
                logger.error(error);
            }

            if (await execution.requireConsensus()) {
                logger.debug(`Executing safe command optimistically still requires consensus`);
                await commandHistoryStorage.addOptimisticComand(command);
                pBlocksFactory.addCommandForConsensusAsync(command);
            }
        } catch (error) {
            callback(error);
        }
    };

    this.executeNoncedCommand = async function (command, callback) {
        callback = $$.makeSaneCallback(callback);
        logger.debug(`Received nonced command ${command.getHash()}`);

        if (!isBootFinished) {
            return callback(new Error(NOT_BOOTED_ERROR));
        }

        if (!command || !(command instanceof Command)) {
            return callback("command not instance of Command");
        }

        try {
            logger.debug(`[nonced-command-${command.getHash()}] getting latest block info...`);
            const latestBlockInfo = consensusCore.getLatestBlockInfo();
            logger.debug(`[nonced-command-${command.getHash()}] got latest block info`, latestBlockInfo);

            logger.debug(`[nonced-command-${command.getHash()}] validating nonced command...`, latestBlockInfo);
            await executionEngine.validateNoncedCommand(command, latestBlockInfo.number);

            logger.debug(`[nonced-command-${command.getHash()}] adding command to history storage...`, latestBlockInfo);
            await commandHistoryStorage.addOptimisticComand(command);

            logger.debug(`[nonced-command-${command.getHash()}] executing method optimistically...`);
            let execution = executionEngine.executeMethodOptimistically(command);

            try {
                callback(undefined, execution);
            } catch (error) {
                console.error(error);
            }

            pBlocksFactory.addCommandForConsensusAsync(command);
        } catch (error) {
            callback(error);
        }
    };

    this.validatePBlockFromNetwork = async function (pBlockMessage, callback) {
        callback = $$.makeSaneCallback(callback);

        if (!isBootFinished) {
            return callback(new Error(NOT_BOOTED_ERROR));
        }

        if (!pBlockMessage) {
            return callback("pBlockMessage not provided");
        }

        pBlockMessage = new PBlockAddedMessage(pBlockMessage);

        try {
            await pBlockMessage.validateSignature();
            pBlocksFactory.forcePBlockCreationForBlockNumberIfAbsentAsync(pBlockMessage.blockNumber);
            consensusCore.addExternalPBlockInConsensusAsync(pBlockMessage);
            callback();
        } catch (error) {
            callback(error);
        }
    };

    this.setValidatorNonInclusion = async function (validatorNonInclusionMessage, callback) {
        callback = $$.makeSaneCallback(callback);

        if (!isBootFinished) {
            return callback(new Error(NOT_BOOTED_ERROR));
        }

        if (!validatorNonInclusionMessage) {
            return callback("validatorNonInclusionMessage not provided");
        }

        validatorNonInclusionMessage = new ValidatorNonInclusionMessage(validatorNonInclusionMessage);

        try {
            await validatorNonInclusionMessage.validateSignature();
            await consensusCore.setValidatorNonInclusionAsync(validatorNonInclusionMessage);
            callback();
        } catch (error) {
            callback(error);
        }
    };
}

const initiliseBrickLedger = async (validatorDID, validatorURL, domain, domainConfig, rootFolder, storageFolder, callback) => {
    callback = $$.makeSaneCallback(callback);

    const validatorDIDString = validatorDID && typeof validatorDID === "object" ? validatorDID.getIdentifier() : validatorDID;
    const logger = new Logger(`[Bricksledger][${domain}][${validatorDIDString}]`);
    logger.debug(`Starting initialization...`, {
        validatorURL,
        rootFolder,
        storageFolder,
        domainConfig: JSON.stringify(domainConfig),
    });

    try {
        if (typeof validatorDID === "string") {
            const w3cDID = require("opendsu").loadAPI("w3cdid");
            validatorDID = await $$.promisify(w3cDID.resolveDID)(validatorDID);
        }

        const config =
            domainConfig && domainConfig.contracts && typeof domainConfig.contracts === "object" ? domainConfig.contracts : {};
        const { maxPBlockSize, maxPBlockTimeMs, pendingBlocksTimeoutMs, nonInclusionCheckTimeoutMs } = config;

        // bind the domain and rootFolder in order to use it easier
        const createFSKeyValueStorage = require("./src/FSKeyValueStorage").create.bind(null, domain, storageFolder);

        let brickStorage = require("./src/FSBrickStorage").create(domain, `domains/${domain}/brick-storage`, storageFolder);
        let commandHistoryStorage = require("./src/CommandHistoryStorage").create(domain, storageFolder);
        await commandHistoryStorage.init();

        let executionEngine = require("./src/ExecutionEngine").create(
            domain,
            domainConfig,
            rootFolder,
            storageFolder,
            createFSKeyValueStorage,
            commandHistoryStorage
        );

        let broadcaster = require("./src/Broadcaster").create(domain, validatorDID, validatorURL, executionEngine);

        let consensusCore = require("./src/ConsensusCore").create(
            validatorDID,
            validatorURL,
            domain,
            storageFolder,
            brickStorage,
            executionEngine,
            broadcaster,
            pendingBlocksTimeoutMs,
            nonInclusionCheckTimeoutMs
        );

        let pBlocksFactory = require("./src/PBlocksFactory").create(
            domain,
            validatorDID,
            brickStorage,
            consensusCore,
            broadcaster,
            maxPBlockSize,
            maxPBlockTimeMs
        );

        const bricksLedger = new BricksLedger(
            domain,
            validatorDID,
            pBlocksFactory,
            broadcaster,
            consensusCore,
            executionEngine,
            brickStorage,
            commandHistoryStorage
        );

        await bricksLedger.boot();

        callback(null, bricksLedger);
    } catch (error) {
        logger.error("Error initializing", error);
        callback(error);
    }
};

const createCommand = (command) => {
    const Command = require("./src/Command");
    return new Command(command);
};

const createFSBrickStorage = (...props) => {
    return require("./src/FSBrickStorage").create(...props);
};

module.exports = {
    initiliseBrickLedger,
    createCommand,
    createFSBrickStorage,
};
