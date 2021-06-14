function BricksLedger(
    validatorDID,
    pBlocksFactory,
    broadcaster,
    consensusCore,
    executionEngine,
    brickStorage,
    commandHistoryStorage
) {
    const Command = require("./src/Command");

    this.getLatestBlockInfo = function (callback) {
        const lastestBlockInfo = consensusCore.getLatestBlockInfo();
        callback(undefined, lastestBlockInfo);
    };

    this.executeSafeCommand = async function (command, callback) {
        callback = $$.makeSaneCallback(callback);

        if (!command || !(command instanceof Command)) {
            return callback("command not instance of Command");
        }

        try {
            await executionEngine.validateSafeCommand(command);

            let execution = executionEngine.executeMethodOptimistically(command);

            try {
                callback(undefined, execution);
            } catch (error) {
                console.error(error);
            }

            if (await execution.requireConsensus()) {
                await commandHistoryStorage.addOptimisticComand(command);
                pBlocksFactory.addCommandForConsensus(command);
            }
        } catch (error) {
            callback(error);
        }
    };

    this.executeNoncedCommand = async function (command, callback) {
        callback = $$.makeSaneCallback(callback);

        if (!command || !(command instanceof Command)) {
            return callback("command not instance of Command");
        }

        try {
            const latestBlockInfo = consensusCore.getLatestBlockInfo();
            await executionEngine.validateNoncedCommand(command, latestBlockInfo.number);

            await commandHistoryStorage.addOptimisticComand(command);

            let execution = executionEngine.executeMethodOptimistically(command);

            try {
                callback(undefined, execution);
            } catch (error) {
                console.error(error);
            }

            pBlocksFactory.addCommandForConsensus(command);
        } catch (error) {
            callback(error);
        }
    };

    this.checkPBlockFromNetwork = async function (pBlock, callback) {
        if (!pBlock) {
            return callback("pBlock not provided");
        }

        try {
            await consensusCore.validatePBlock(pBlock);
            await executionEngine.executePBlock(pBlock);
            await consensusCore.addInConsensusAsync(pBlock);
        } catch (error) {
            callback(error);
        }
    };
}

const initiliseBrickLedger = async (validatorDID, domain, domainConfig, rootFolder, notificationHandler, callback) => {
    try {
        if (typeof validatorDID === "string") {
            const w3cDID = require("opendsu").loadAPI("w3cdid");
            validatorDID = await $$.promisify(w3cDID.resolveDID)(validatorDID);
        }

        let broadcaster;

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
        await executionEngine.loadContracts();

        let consensusCore = require("./src/ConsensusCore.js").create(domain, rootFolder, brickStorage, executionEngine);
        await consensusCore.init();

        let pBlocksFactory = require("./src/PBlocksFactory").create(domain, validatorDID, brickStorage, consensusCore);
        // let broadcaster = require("./src/broadcaster.js").create(domain);

        const bricksLedger = new BricksLedger(
            validatorDID,
            pBlocksFactory,
            broadcaster,
            consensusCore,
            executionEngine,
            brickStorage,
            commandHistoryStorage
        );
        callback(null, bricksLedger);
    } catch (error) {
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
