const StorageValue = require("./StorageValue");

class FSKeyValueStorage {
    constructor(domain, rootFolder, subFolderName) {
        this.domain = domain;
        this.rootFolder = rootFolder;

        this.basePath = require("path").join(rootFolder, "domain-storage", domain, subFolderName);
        this.isOptimisticMode = true;
        this.commandHash = null;
    }

    async init() {
        try {
            await this._ensureBasePathExists();
        } catch (error) {
            console.log(error);
        }
    }

    enterOptimisticMode(commandHash) {
        this.isOptimisticMode = true;
        this.commandHash = commandHash;
    }

    enterValidatedMode(commandHash) {
        this.isOptimisticMode = false;
        this.commandHash = commandHash;
    }

    async set(key, newValueObject) {
        // since the set is called then changes are made, so consensus is required
        if (this.isOptimisticMode) {
            console.log("[FSKeyValueStorage] Detected changes during optimistic run");
            this.commandRequiresConsensus = true;
        }

        const keyFilePath = this._getKeyPath(key);
        const storageValue = await this._getStorageValue(key);

        if (this.isOptimisticMode) {
            storageValue.addPending(this.commandHash, newValueObject);
        } else {
            storageValue.updateValidated(this.commandHash, newValueObject);
        }

        await $$.promisify(require("fs").writeFile)(keyFilePath, storageValue.asString());
    }

    async get(key) {
        const storageValue = await this._getStorageValue(key);
        return storageValue.getValue(true);
    }

    async getValidated(key) {
        const storageValue = await this._getStorageValue(key);
        return storageValue.getValue(false);
    }

    requireConsensus() {
        return this.commandRequiresConsensus;
    }

    _getKeyPath(key) {
        return `${this.basePath}/${key}`;
    }

    async _getStorageValue(key) {
        const keyFilePath = this._getKeyPath(key);
        try {
            const keyContent = await $$.promisify(require("fs").readFile)(keyFilePath);
            const value = new StorageValue(keyContent);
            return value;
        } catch (error) {
            if (error.code === "ENOENT") {
                // file doesn't exists, so we consider thee value to be null
                const value = new StorageValue();
                return value;
            }

            throw err;
        }
    }

    async _ensureBasePathExists() {
        const fs = require("fs");
        try {
            await $$.promisify(fs.access)(this.basePath);
        } catch (error) {
            // base folder doesn't exists, so we create it
            await $$.promisify(fs.mkdir)(this.basePath, { recursive: true });
        }
    }
}

function create(domain, rootFolder, subFolderName) {
    return new FSKeyValueStorage(domain, rootFolder, subFolderName);
}

module.exports = {
    create,
};
