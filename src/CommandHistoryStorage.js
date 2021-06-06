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
        const basePath = path.join(this.rootFolder, "command-storage");
        try {
            await ensurePathExists(basePath);
        } catch (error) {
            console.log(error);
        }

        this.filePath = path.join(basePath, this.domain);

        const fs = require("fs");
        this.stream = fs.createWriteStream(this.filePath, { flags: "a" });
    }

    async addComand(command) {
        const os = require("os");
        const line = `${os.EOL}${command.getHash()}`;
        await $$.promisify(this.stream.write.bind(this.stream))(line);
    }

    async isCommandHashRegistered(commandHash) {
        const os = require("os");
        return new Promise((resolve, reject) => {
            let isCommandRegistered = false;
            const fs = require("fs");
            const readStream = fs.createReadStream(this.filePath);
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
