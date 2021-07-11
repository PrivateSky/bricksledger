const { ensurePathExists } = require("./utils/fs-utils");

class CommandHistoryStorage {
    constructor(domain, storageFolder) {
        this.domain = domain;
        this.storageFolder = storageFolder;
    }

    async init() {
        const path = require("path");
        const basePath = path.join(this.storageFolder, "domains", this.domain, "command-storage");
        await ensurePathExists(basePath);

        this.optimisticFilePath = path.join(basePath, "optimistic");
        this.validatedFilePath = path.join(basePath, "validated");

        // this.optimisticStreamWriter = fs.createWriteStream(this.optimisticFilePath, { flags: "a" });
        // this.validatedStreamWriter = fs.createWriteStream(this.validatedFilePath, { flags: "a" });
    }

    async addOptimisticComand(command) {
        const fs = require("fs");
        const os = require("os");
        const line = `${os.EOL}${command.getHash()}`;
        const optimisticStreamWriter = fs.createWriteStream(this.optimisticFilePath, { flags: "a" });
        await $$.promisify(optimisticStreamWriter.write.bind(optimisticStreamWriter))(line);
        optimisticStreamWriter.close();
    }

    async addValidatedComand(command) {
        const fs = require("fs");
        const os = require("os");
        const line = `${os.EOL}${command.getHash()}`;
        const validatedStreamWriter = fs.createWriteStream(this.validatedFilePath, { flags: "a" });
        await $$.promisify(validatedStreamWriter.write.bind(validatedStreamWriter))(line);
        validatedStreamWriter.close();
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
                })
                .on("error", function (error) {
                    if (error.code === "ENOENT") {
                        // the file doesn't exist to the command isn't registered
                        return resolve(false);
                    }

                    // we receive an error different than 'no such file'
                    reject(error);
                });
        });
    }
}

function create(domain, storageFolder) {
    return new CommandHistoryStorage(domain, storageFolder);
}

module.exports = {
    create,
};
