const Logger = require("./src/Logger");

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
    const Command = require("./src/Command");
    const PBlockAddedMessage = require("./src/Broadcaster/PBlockAddedMessage");

    const logger = new Logger(`[Bricksledger][${domain}][${validatorDID.getIdentifier()}]`);

    this.boot = async function () {
        logger.info("Booting BricksLedger...");
        await consensusCore.boot();
        logger.info("Booting BricksLedger finished...");
    };

    this.getLatestBlockInfo = function (callback) {
        const lastestBlockInfo = consensusCore.getLatestBlockInfo();
        callback(undefined, lastestBlockInfo);
    };

    this.executeSafeCommand = async function (command, callback) {
        logger.debug(`Received safe command ${command.getHash()}`);

        callback = $$.makeSaneCallback(callback);

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
        logger.debug(`Received nonced command ${command.getHash()}`);
        callback = $$.makeSaneCallback(callback);

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

        if (!pBlockMessage) {
            return callback("pBlockMessage not provided");
        }

        pBlockMessage = new PBlockAddedMessage(pBlockMessage);

        try {
            await pBlockMessage.validateSignature();
            await consensusCore.addExternalPBlockInConsensusAsync(pBlockMessage);
        } catch (error) {
            callback(error);
        }
    };
}

const initiliseBrickLedger = async (
    validatorDID,
    validatorURL,
    domain,
    domainConfig,
    rootFolder,
    notificationHandler,
    config,
    callback
) => {
    if (typeof config === "function") {
        callback = config;
        config = {};
    }

    callback = $$.makeSaneCallback(callback);

    const validatorDIDString = validatorDID && typeof validatorDID === "object" ? validatorDID.getIdentifier() : validatorDID;
    const logger = new Logger(`[Bricksledger][${domain}][${validatorDIDString}]`);
    logger.debug(`Starting initialization...`, { validatorURL, rootFolder, domainConfig: JSON.stringify(domainConfig) });

    try {
        if (typeof validatorDID === "string") {
            const w3cDID = require("opendsu").loadAPI("w3cdid");
            validatorDID = await $$.promisify(w3cDID.resolveDID)(validatorDID);
        }

        const { maxPBlockSize, maxPBlockTimeMs, maxBlockTimeMs } = config;

        // bind the domain and rootFolder in order to use it easier
        const createFSKeyValueStorage = require("./src/FSKeyValueStorage").create.bind(null, domain, rootFolder);

        let brickStorage = require("./src/FSBrickStorage").create(domain, `domains/${domain}/brick-storage`, rootFolder);
        let commandHistoryStorage = require("./src/CommandHistoryStorage").create(domain, rootFolder);
        await commandHistoryStorage.init();

        let executionEngine = require("./src/ExecutionEngine").create(
            domain,
            domainConfig,
            rootFolder,
            createFSKeyValueStorage,
            commandHistoryStorage,
            notificationHandler
        );

        let consensusCore = require("./src/ConsensusCore").create(
            validatorDID,
            validatorURL,
            domain,
            rootFolder,
            maxBlockTimeMs,
            brickStorage,
            executionEngine
        );

        let broadcaster = require("./src/Broadcaster").create(domain, validatorDID, validatorURL, executionEngine);
        let pBlocksFactory = require("./src/PBlocksFactory").create(
            domain,
            validatorDID,
            brickStorage,
            consensusCore,
            broadcaster,
            maxPBlockSize,
            maxPBlockTimeMs
        );

        await executionEngine.loadContracts(pBlocksFactory);

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
        logger.log("Error initializing", error);
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
