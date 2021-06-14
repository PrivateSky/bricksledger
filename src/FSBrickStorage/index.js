class FSBrickPathsManager {
    constructor() {
        this.brickPaths = {};
        this.utils = require("./utils");
    }

    storeDomainPath(domainName, domainFolder, serverRoot) {
        if (!this.brickPaths[domainName]) {
            this.brickPaths[domainName] = require("path").join(serverRoot || "", domainFolder || domainName);
        }
    }

    removeDomainPath(domainName) {
        delete this.brickPaths[domainName];
    }

    resolveBrickPath(domainName, brickHash) {
        return require("path").join(this.resolveBrickDirname(domainName, brickHash), brickHash);
    }

    resolveBrickDirname(domainName, brickHash) {
        this.utils.verifyBrickHash(brickHash);
        return require("path").join(this.brickPaths[domainName], brickHash.substr(0, this.utils.HASH_MAX_SIZE));
    }

    getUtils() {
        return this.utils;
    }
}

const fsBrickPathsManager = new FSBrickPathsManager();

class FSBrickStorage {
    constructor(domainName, domainFolder, serverRoot) {
        this.domain = domainName;

        fsBrickPathsManager.storeDomainPath(this.domain, domainFolder, serverRoot);
    }

    getBrick(hash, callback) {
        callback = $$.makeSaneCallback(callback);

        this.getBrickAsync(hash)
            .then(result => callback(undefined, result))
            .catch(error => callback(error));
    }

    async getBrickAsync(hash) {
        const fs = require("fs");
        const brickPath = fsBrickPathsManager.resolveBrickPath(this.domain, hash);
        await $$.promisify(fs.access)(brickPath);
        return await $$.promisify(fs.readFile)(brickPath, 'UTF8');
    }

    addBrick(data, callback) {
        callback = $$.makeSaneCallback(callback);

        this.addBrickAsync(data)
            .then(result => callback(undefined, result))
            .catch(error => callback(error));
    }

    async addBrickAsync(data) {
        const fs = require("fs");
        const crypto = require("opendsu").loadAPI("crypto");
        const hash = crypto.sha256(data);

        // TODO: use sha256Async witch uses syndicate
        // const hash = await $$.promisify(crypto.sha256Async)(data);
        // (?) async conflicts with "promisify" convention

        const brickDirPath = fsBrickPathsManager.resolveBrickDirname(this.domain, hash);
        if (!(await $$.promisify(fs.exists)(brickDirPath))) {
            await $$.promisify(fs.mkdir)(brickDirPath, { recursive: true });
        }
        await $$.promisify(fs.access)(brickDirPath);

        const brickPath = fsBrickPathsManager.resolveBrickPath(this.domain, hash);
        await $$.promisify(fs.writeFile)(brickPath, data, 'UTF8');

        return hash;
    }

    deleteBrick(hash, callback) {
        callback = $$.makeSaneCallback(callback);

        this.deleteBrickAsync(hash)
            .then(result => callback(undefined, result))
            .catch(error => callback(error));
    }

    async deleteBrickAsync(hash) {
        const fs = require("fs");
        const brickPath = fsBrickPathsManager.resolveBrickPath(this.domain, hash);
        await $$.promisify(fs.access)(brickPath);
        await $$.promisify(fs.unlink)(brickPath);

        const brickDirPath = fsBrickPathsManager.resolveBrickDirname(this.domain, hash);
        await $$.promisify(fs.access)(brickDirPath);
        await $$.promisify(fs.rmdir)(brickDirPath, { recursive: true });
    }

    get utils() {
        return ({ ...fsBrickPathsManager.getUtils() })
    }
}

function create(...params) {
    return new FSBrickStorage(...params);
}

module.exports = {
    create
};