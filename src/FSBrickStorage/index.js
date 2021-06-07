const fs = require('fs');
const path = require('path');

class FSBrickPaths {
    constructor() {
        this.brickPaths = {};
        this.utils = require("./utils");
    }

    storeDomainPath(domainName, domainPath, serverRootPath) {
        if (!this.brickPaths[domainName]) {
            this.brickPaths[domainName] = path.join(serverRootPath || "", domainPath || domainName);
        }
    }

    removeDomainPath(domainName) {
        delete this.brickPaths[domainName];
    }

    resolveBrickPath(domainName, brickHash) {
        return path.join(this.resolveBrickDirname(domainName, brickHash), brickHash);
    }

    resolveBrickDirname(domainName, brickHash) {
        this.utils.verifyBrickHash(brickHash);
        return path.join(this.brickPaths[domainName], brickHash.substr(0, this.utils.HASH_MAX_SIZE));
    }

    getUtils() {
        return this.utils;
    }
}

const fsBrickPathsManager = new FSBrickPaths();

class FSBrickStorage {
    constructor(domain, config = {}) {
        console.log(`[Bricking] FSBrickStorage initialized`)

        this.domain = domain;
        this.config = config;

        fsBrickPathsManager.storeDomainPath(this.domain, this.config.domain?.path, this.config.server?.path);
    }

    getBrick(hash, callback) {
        callback = $$.makeSaneCallback(callback);

        this.getBrickAsync(hash)
            .then(result => callback(undefined, result))
            .catch(error => callback(error));
    }

    async getBrickAsync(hash) {
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
        const crypto = require("opendsu").loadAPI("crypto");
        const hash = crypto.sha256(data);

        // TODO: hash using "syndicate" with a thread pool when main tread is active and NodeJS is used
        // signature: sha256Async(data, callback)
        // async conflicts with "promisify" convention

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
        const brickPath = fsBrickPathsManager.resolveBrickPath(this.domain, hash);
        await $$.promisify(fs.access)(brickPath);
        await $$.promisify(fs.unlink)(brickPath, 'UTF8');

        const brickDirPath = fsBrickPathsManager.resolveBrickDirname(this.domain, hash);
        await $$.promisify(fs.access)(brickDirPath);
        await $$.promisify(fs.rmdir)(brickDirPath, { recursive: true });
    }

    get utils() {
        return ({ ...fsBrickPathsManager.getUtils() })
    }
}

function create(...props) {
    return new FSBrickStorage(...props);
}

module.exports = {
    create
};