const StorageValue = require("./StorageValue");

class FSKeyValueStorage {
    constructor(domain, storageFolder, subFolderName) {
        this.domain = domain;
        this.storageFolder = storageFolder;

        this.basePath = require("path").join(storageFolder, "domain-storage", domain, subFolderName);
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

        //await $$.promisify(require("fs").writeFile)(keyFilePath, storageValue.asString());
        await this.withFileLock(this._getFileLockPath(key), async () => {
            await $$.promisify(require("fs").writeFile)(keyFilePath, storageValue.asString());
        })
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

    _getFileLockPath(key) {
        return `${this.basePath}/.${key}`;
    }

    async _getStorageValue(key) {
        const keyFilePath = this._getKeyPath(key);
        try {
            let keyContent;

            await this.withFileLock(this._getFileLockPath(key), async () => {
                keyContent = await $$.promisify(require("fs").readFile)(keyFilePath);
            });

            const value = new StorageValue(keyContent);
            return value;
        } catch (error) {
            if (error.code === "ENOENT") {
                // file doesn't exists, so we consider thee value to be null
                const value = new StorageValue();
                return value;
            }

            throw error;
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

    async withFileLock(file, fn) {
        const { constants } = require('os');
        const fs = require('fs');

        const delay = (ms) => {
            return new Promise((resolve) => {
                setTimeout(resolve, ms);
            });
        }

        const aquireLock = async () => {
            try {
                fs.mkdirSync(file);
                return;
            } catch (e) {
                if (e.errno !== constants.errno.EEXIST * -1) {
                    throw e;
                }

                let createdAt;
                try {
                    createdAt = fs.statSync(file).birthtimeMs;
                } catch (e) {
                    if (e.errno !== constants.errno.ENOENT * -1) {
                        return await aquireLock();
                    }
                    throw e;
                }
                const expiredThreshold = 30 * 1000; // Lock is considered expired after 30 seconds
                if ((Date.now() - createdAt) >= expiredThreshold) {
                    return await aquireLock();
                }

                await delay(50);
                return await aquireLock();
            }
        }

        const unlock = () => {
            fs.rmdirSync(file);
        }

        await aquireLock();
        try {
            await fn()
        } catch (e) {
            throw e;
        } finally {
            unlock();
        }
    }
}

function create(domain, storageFolder, subFolderName) {
    return new FSKeyValueStorage(domain, storageFolder, subFolderName);
}

module.exports = {
    create,
};
