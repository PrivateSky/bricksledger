/*
A configurable consensus core that can have 3 consensus strategies
 - SVBC - Single Validator BrickLedger Consensus:  Only one node is accepting commands and propose BrickBlocks. A block has only one BrickBlock.
 - MVBC - Multiple Validators BrickLedger Consensus: run the BrickLedger consensus between validators
 - OBAC - Other Blockchain Adapter Consensus: Delegates Consensus to a blockchain adapter that is using other blockchain network for consensus regrading the blocks of commands 
*/

const PBlock = require("./PBlock");

async function getValidatorsForCurrentDomain(executionEngine) {
    const { contracts } = executionEngine;
    const domainInfo = await contracts.bdns.getDomainInfo();
    return domainInfo.validators;
}

async function ensurePathExists(path) {
    const fs = require("fs");
    try {
        await $$.promisify(fs.access)(path);
    } catch (error) {
        // base folder doesn't exists, so we create it
        await $$.promisify(fs.mkdir)(path, { recursive: true });
    }
}

function createNewBlock(pBlocksInfo, latestBlockHash) {
    const pBlockNumber = pBlocksInfo[0].pBlock.blockNumber;
    const participatingPBlockHashLinks = pBlocksInfo.map((pBlock) =>
        typeof pBlock.hashLinkSSI === "string" ? pBlock.hashLinkSSI : pBlock.hashLinkSSI.getIdentifier()
    );
    participatingPBlockHashLinks.sort();

    const block = {
        pbs: participatingPBlockHashLinks,
        blockNumber: pBlockNumber,
        previousBlock: latestBlockHash,
    };

    return block;
}

async function saveBlockInBricks(block, domain, brickStorage) {
    const openDSU = require("opendsu");
    const keySSISpace = openDSU.loadApi("keyssi");

    const brickHash = await brickStorage.addBrickAsync(block);

    const hashLinkSSI = keySSISpace.createHashLinkSSI(domain, brickHash);
    return hashLinkSSI;
}

async function appendValidatedBlockHash(blockHash, writeStream) {
    const os = require("os");
    const line = `${os.EOL}${blockHash}`;
    await $$.promisify(writeStream.write.bind(writeStream))(line);
}

class ConsensusCore {
    constructor(domain, rootFolder, brickStorage, executionEngine) {
        this.domain = domain;
        this.rootFolder = rootFolder;
        this.brickStorage = brickStorage;
        this.executionEngine = executionEngine;

        this._latestBlockNumber = 0;
        this._latestBlockHash = null;

        this._pendingPBlocksInfoByBlockNumber = {};
    }

    async init() {
        const { domain, rootFolder } = this;
        const path = require("path");
        const validatedBlocksFolderPath = path.join(rootFolder, "domains", domain);
        const validatedBlocksFilePath = path.join(validatedBlocksFolderPath, "blocks");

        try {
            await ensurePathExists(validatedBlocksFolderPath);
        } catch (error) {
            console.log(error);
        }

        const fs = require("fs");
        this.validatedBlocksWriteStream = fs.createWriteStream(validatedBlocksFilePath, { flags: "a" });
    }

    addInConsensus(pBlock, pBlockHashLinkSSI, callback) {
        callback = $$.makeSaneCallback(callback);

        this.addInConsensusAsync(pBlock, pBlockHashLinkSSI)
            .then((result) => callback(undefined, result))
            .catch((error) => callback(error));
    }

    async addInConsensusAsync(pBlock, pBlockHashLinkSSI) {
        await this.validatePBlockAsync(pBlock);

        const { blockNumber } = pBlock;

        if (!this._pendingPBlocksInfoByBlockNumber[blockNumber]) {
            this._pendingPBlocksInfoByBlockNumber[blockNumber] = [];
        }
        const pBlocksForConsensus = this._pendingPBlocksInfoByBlockNumber[blockNumber];

        return new Promise(async (resolve, reject) => {
            pBlocksForConsensus.push({
                pBlock,
                hashLinkSSI: pBlockHashLinkSSI,
                callback: (error, result) => {
                    if (error) {
                        return reject(error);
                    }
                    resolve(result);
                },
            });

            const validators = await getValidatorsForCurrentDomain(this.executionEngine);
            const canStartConsensus = validators.length === pBlocksForConsensus.length;
            if (canStartConsensus) {
                console.log(`[Consensus] Starting consensus for pBlock ${blockNumber}...`);
                this._startConsensusForBlockNumber(pBlocksForConsensus);
            }
        });
    }

    validatePBlock(pBlock, callback) {
        callback = $$.makeSaneCallback(callback);

        this.validatePBlockAsync(pBlock)
            .then((result) => callback(undefined, result))
            .catch((error) => callback(error));
    }

    async validatePBlockAsync(pBlock) {
        pBlock = new PBlock(pBlock);

        const { blockNumber } = pBlock;

        if (blockNumber <= this._latestBlockNumber) {
            throw new Error(
                `pBlock has block number ${blockNumber} less than or equal to the  latest block number ${_latestBlockNumber}`
            );
        }

        await pBlock.validateSignature();

        // TODO: check if validatorDID is valid for participating into consensus
    }

    getLatestBlockInfo() {
        return {
            number: this._latestBlockNumber,
            hash: this._latestBlockHash,
        };
    }

    async _startConsensusForBlockNumber(pBlocksInfoForConsensus) {
        setTimeout(async () => {
            try {
                // consensus finished with success, so generate block and broadcast it
                const block = createNewBlock(pBlocksInfoForConsensus, this._latestBlockHash);
                console.log("createNewBlock", block);
                const blockHashLinkSSI = await saveBlockInBricks(block, this.domain, this.brickStorage);

                this._latestBlockHash = blockHashLinkSSI.getIdentifier();
                this._latestBlockNumber = block.blockNumber;
                console.log("seting", block.blockNumber);

                await appendValidatedBlockHash(this._latestBlockHash, this.validatedBlocksWriteStream);

                // execute each pBlock and then call the block info callback in order for pBlocksFactory to know to continue pBlocks creations
                for (let index = 0; index < pBlocksInfoForConsensus.length; index++) {
                    const { pBlock, callback } = pBlocksInfoForConsensus[index];
                    const saneCallback = $$.makeSaneCallback(callback);

                    try {
                        await this.executionEngine.executePBlock(pBlock);
                        saneCallback();
                    } catch (error) {
                        saneCallback(error);
                    }
                }
            } catch (error) {
                console.error("Error while executing pBlock", error);
                throw error;
            }
        }, 1000);
    }
}

function create(...params) {
    return new ConsensusCore(...params);
}

module.exports = {
    create,
};
