class StorageValue {
    constructor(stringValue) {
        this.value = stringValue
            ? JSON.parse(stringValue)
            : {
                  validated: null,
                  pending: [],
              };
    }

    updateValidated(commandHash, validatedValue) {
        this.value.validated = validatedValue;
        const pendingCommandIndex = this.value.pending.findIndex((command) => command.commandHash === commandHash);
        if (pendingCommandIndex !== -1) {
            this.value.pending.splice(pendingCommandIndex, 1);
        }
    }

    addPending(commandHash, newValue) {
        this.value.pending.push({ commandHash, newValue });
    }

    asString() {
        return JSON.stringify(this.value);
    }

    /*
        if latest is false, return the validate value, otherwise get the latest
    */
    getValue(latest) {
        if (!latest) {
            return this.value.validated;
        }

        const { pending } = this.value;
        if (!pending.length) {
            // if there are no latest values so return the validated one
            return this.value.validated;
        }

        const latestValue = pending[pending.length - 1].newValue;
        return latestValue;
    }
}

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
        this.commandRequiresConsensus = true;

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
