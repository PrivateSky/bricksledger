function BricksLedger(
    validatorDID,
    pBlocksFactory,
    broadcaster,
    consensusCore,
    executionEngine,
    bricksStorage,
    commandHistoryStorage
) {
    const Command = require("./src/Command");

    this.executeSafeCommand = async function (command, callback) {
        if (!command || !(command instanceof Command)) {
            return callback("command not instance of Command");
        }

        try {
            await executionEngine.validateCommand(command);

            let execution = executionEngine.executeMethodOptimistcally(command);

            try {
                callback(undefined, execution);
            } catch (error) {
                console.error(error);
            }

            if (await execution.requireConsensus()) {
                await commandHistoryStorage.addComand(command);
                pBlocksFactory.addCommandForConsensus(command);
            }
        } catch (error) {
            callback(error);
        }
    };

    this.executeNoncedCommand = async function (command, callback) {
        if (!command || !(command instanceof Command)) {
            return callback("command not instance of Command");
        }

        try {
            await executionEngine.validateCommand(command);
            await commandHistoryStorage.addComand(command);

            let execution = executionEngine.executeMethodOptimistcally(command);

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
        // validate pBlock

        try {
            await executionEngine.executePBlock(pBlock);
            consensusCore.addInConsensus(pBlock);
        } catch (error) {
            callback(error);
        }
    };
}

const initiliseBrickLedger = async (validatorDID, domain, domainConfig, rootFolder, notificationHandler, callback) => {
    try {
        let bricksStorage;
        // let pBlocksFactory;
        // let consensusCore;
        let broadcaster;

        // let bricksStorage = require("./src/FSBricksStorage.js").create(domain, domainConfig);
        let commandHistoryStorage = require("./src/CommandHistoryStorage").create(domain, rootFolder);
        await commandHistoryStorage.init();

        let pBlocksFactory = require("./src/PBlocksFactory.js").create(domain);
        const createFSKeyValueStorage = require("./src/FSKeyValueStorage.js").create;

        let executionEngine = require("./src/ExecutionEngine.js").create(
            domain,
            domainConfig,
            rootFolder,
            createFSKeyValueStorage,
            commandHistoryStorage,
            notificationHandler
        );
        await executionEngine.loadContracts();

        let consensusCore = require("./src/ConsensusCore.js").create(domain);
        // let broadcaster = require("./src/broadcaster.js").create(domain);

        const bricksLedger = new BricksLedger(
            validatorDID,
            pBlocksFactory,
            broadcaster,
            consensusCore,
            executionEngine,
            bricksStorage,
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
}

module.exports = {
    initiliseBrickLedger,
    createCommand,
    createFSBrickStorage
};
