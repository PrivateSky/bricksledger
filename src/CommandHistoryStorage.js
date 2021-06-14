async function ensurePathExists(path) {
    const fs = require("fs");
    try {
        await $$.promisify(fs.access)(path);
    } catch (error) {
        // base folder doesn't exists, so we create it
        await $$.promisify(fs.mkdir)(path, { recursive: true });
    }
}

class CommandHistoryStorage {
    constructor(domain, rootFolder) {
        this.domain = domain;
        this.rootFolder = rootFolder;
    }

    async init() {
        const path = require("path");
        const basePath = path.join(this.rootFolder, "domains", this.domain, "command-storage");
        await ensurePathExists(basePath);

        this.optimisticFilePath = path.join(basePath, "optimistic");
        this.validatedFilePath = path.join(basePath, "validated");

        const fs = require("fs");
        this.optimisticStreamWriter = fs.createWriteStream(this.optimisticFilePath, { flags: "a" });
        this.validatedStreamWriter = fs.createWriteStream(this.validatedFilePath, { flags: "a" });
    }

    async addOptimisticComand(command) {
        const os = require("os");
        const line = `${os.EOL}${command.getHash()}`;
        await $$.promisify(this.optimisticStreamWriter.write.bind(this.optimisticStreamWriter))(line);
    }

    async addValidatedComand(command) {
        const os = require("os");
        const line = `${os.EOL}${command.getHash()}`;
        await $$.promisify(this.validatedStreamWriter.write.bind(this.validatedStreamWriter))(line);
    }

    async isOptimisticCommandHashRegistered(commandHash) {
        return await this._isCommandHashRegistered(this.optimisticFilePath, commandHash);
    }

    async isValidatedCommandHashRegistered(commandHash) {
        return await this._isCommandHashRegistered(this.validatedFilePath, commandHash);
    }

    async _isCommandHashRegistered(commandFilePath, commandHash) {
        const os = require("os");
        return new Promise((resolve, reject) => {
            let isCommandRegistered = false;
            const fs = require("fs");
            const readStream = fs.createReadStream(commandFilePath);
            readStream
                .on("data", function (chunk) {
                    const hashes = chunk.toString().split(os.EOL);
                    const isHashPresent = hashes.some((hash) => hash && hash.trim() === commandHash);

                    if (isHashPresent) {
                        isCommandRegistered = true;
                        resolve(true);
                        readStream.destroy();
                    }
                })
                .on("close", function (error) {
                    if (error) {
                        return reject(error);
                    }
                    if (!isCommandRegistered) {
                        resolve(false);
                    }
                });
        });
    }
}

function create(domain, rootFolder) {
    return new CommandHistoryStorage(domain, rootFolder);
}

module.exports = {
    create,
};
