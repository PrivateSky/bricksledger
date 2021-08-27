const path = require("path");
const fs = require("fs");
const History = require("./History");

const DEFAULT_HISTORY_TIME_WINDOW = 3600 * 24;

class CommandHistoryStorage {
    constructor(domain, storageFolder, timeWindow = 3600) {
        const basePath = path.join(storageFolder, 'domains', domain, 'command-storage');
    
        try {
            fs.accessSync(basePath)
        } catch (e) {
            fs.mkdirSync(basePath, { recursive: true});
        }
        this.optimisticHistory = new History(path.join(basePath, 'optimistic'), timeWindow);
        this.validatedHistory = new History(path.join(basePath, 'validated'), timeWindow);
    }

    async init() {
        await this.optimisticHistory.init();
        await this.validatedHistory.init();
    }

    async addOptimisticComand(command) {
        return await this.optimisticHistory.add(command.getHash());
    }

    async addValidatedComand(command) {
        return await this.validatedHistory.add(command.getHash());
    }

    isOptimisticCommandHashRegistered(commandHash) {
        return this.optimisticHistory.has(commandHash);
    }

    isValidatedCommandHashRegistered(commandHash) {
        return this.validatedHistory.has(commandHash);
    }
}

function create(domain, storageFolder, timeWindow = DEFAULT_HISTORY_TIME_WINDOW) {
    return new CommandHistoryStorage(domain, storageFolder, timeWindow);
}

module.exports = {
    create,
};
