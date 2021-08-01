const Logger = require("../Logger");
const Block = require("../Block");
function getHashFromHashLinkSSI(hashLinkSSI) {
    const keySSI = require("opendsu").loadApi("keyssi");
    hashLinkSSI = keySSI.parse(hashLinkSSI);
    return hashLinkSSI.getHash();
}

const VALIDATOR_SYNC_INTERVAL_MS = 10 * 1000;

class ValidatorSynchronizer {
    constructor(
        domain,
        currentValidatorDID,
        currentValidatorURL,
        validator,
        brickStorage,
        getLatestBlockInfo,
        getLocalValidators,
        validatorContractExecutorFactory,
        executeBlock,
        onSyncFinished
    ) {
        this.domain = domain;
        this.currentValidatorDID = currentValidatorDID;
        this.currentValidatorURL = currentValidatorURL;
        this.validatorDID = validator.DID;
        this.validatorURL = validator.URL;
        this.brickStorage = brickStorage;
        this.getLatestBlockInfo = getLatestBlockInfo;
        this.getLocalValidators = getLocalValidators;
        this.validatorContractExecutorFactory = validatorContractExecutorFactory;
        this.executeBlock = executeBlock;
        this.onSyncFinished = onSyncFinished;

        this._logger = new Logger(
            `[Bricksledger][${domain}][${this.currentValidatorDID.getIdentifier()}][Consensus][ValidatorSynchronizer]`
        );
        this._logger.info("Create finished");
    }

    async synchronize() {
        const { domain, validatorDID, validatorURL, validatorContractExecutorFactory } = this;

        this._logger.info(`Checking validator '${validatorDID}' for validator list...`);
        this._validatorContractExecutor = validatorContractExecutorFactory.create(
            domain,
            this.currentValidatorDID,
            validatorDID,
            validatorURL
        );

        this._blockSyncInterval = setInterval(async () => {
            this._runSyncFlow();
        }, VALIDATOR_SYNC_INTERVAL_MS);

        this._runSyncFlow();
    }

    async _runSyncFlow() {
        if (this._isSyncInProgress) {
            this._logger.info("Another block sync is already in progress...");
            return;
        }

        try {
            this._isSyncInProgress = true;
            await this._getMissingBlocksFromValidator();
            await this._proposeSelfAsValidator();
        } catch (error) {
            this._logger.error("An error has occured while running sync flow", error);
            throw error;
        } finally {
            this._isSyncInProgress = false;
        }
    }

    async _getMissingBlocksFromValidator() {
        const { domain, validatorDID } = this;

        this._logger.info(`Checking validator '${validatorDID}' for latest block info...`);

        const validatorLatestBlockInfo = await this._validatorContractExecutor.getLatestBlockInfoAsync();
        const { number, hash } = validatorLatestBlockInfo;
        this._logger.info(`Validator '${validatorDID}' responded with block number ${number} and latest hash ${hash}...`);

        const { number: latestBlockNumber, hash: latestBlockHash } = this.getLatestBlockInfo();
        if (latestBlockNumber < number) {
            this._logger.info(`Starting synchronization with validator '${validatorDID}'...`);

            const missingBlocks = [];

            let queriedBlockHash = hash;
            while (true) {
                this._logger.info(`Getting block with hash '${queriedBlockHash}' from validator '${validatorDID}'...`);
                const blockInfo = await this._validatorContractExecutor.getBlockAsync(queriedBlockHash);
                const block = new Block(blockInfo);
                block.hashLinkSSI = queriedBlockHash;
                missingBlocks.unshift(block);

                if (!block.previousBlock || block.previousBlock === latestBlockHash) {
                    this._logger.info(
                        `Finished getting ${missingBlocks.length} missing block(s) from validator '${validatorDID}'`
                    );
                    break;
                }

                queriedBlockHash = block.previousBlock;
            }

            for (let blockIndex = 0; blockIndex < missingBlocks.length; blockIndex++) {
                const missingBlock = missingBlocks[blockIndex];
                this._logger.info(
                    `Getting pblocks for block number ${missingBlock.blockNumber} [${blockIndex + 1}/${missingBlocks.length}]'...`
                );

                // loading pblock for block
                const pBlocks = [];
                for (let pBlockIndex = 0; pBlockIndex < missingBlock.pbs.length; pBlockIndex++) {
                    const pBlockHash = missingBlock.pbs[pBlockIndex];
                    this._logger.debug(`Checking pblock '${pBlockHash}' [${pBlockIndex + 1}/${missingBlock.pbs.length}]...`);

                    const pBlockBrickHash = getHashFromHashLinkSSI(pBlockHash);
                    let pBlock;

                    try {
                        this._logger.debug(`Getting pblock '${pBlockHash}' from brickstorage (hash: ${pBlockBrickHash})...`);
                        pBlock = await this.brickStorage.getBrickAsync(pBlockBrickHash);
                    } catch (error) {
                        this._logger.debug(`Pblock '${pBlockHash}' not present in brickstorage, so adding it...`, error);

                        this._logger.debug(`Getting pblock '${pBlockHash}'...`);
                        pBlock = await this._validatorContractExecutor.getPBlockAsync(pBlockHash);

                        this._logger.debug(`Storing pblock '${pBlockHash}' in brickstorage...`);
                        try {
                            const hash = await this.brickStorage.addBrickAsync(pBlock.getSerialisation());
                            if (hash !== pBlockBrickHash) {
                                this._logger.error(
                                    `PBlock '${pBlockHash}' has it's hash equal to '${pBlockBrickHash}', but saving it locally has returned a hash of '${hash}'`
                                );
                            }
                        } catch (error) {
                            // we can continue the boot even if the pblock cache storage failed
                            this._logger.debug(`Storing pblock '${pBlockHash}' in brickstorage failed`, error);
                            throw error;
                        }
                    }

                    pBlocks.push(pBlock);
                }

                this._logger.info(`Executing block with hash '${missingBlock.hashLinkSSI}'...`);
                await this.executeBlock(missingBlock, pBlocks);
            }
        } else {
            this._logger.info(
                `Synchronization with validator '${validatorDID}' (${number} block(s)) is not needed since it doesn't have newer block - self hash ${latestBlockNumber} block(s)`
            );
        }
    }

    async _proposeSelfAsValidator() {
        const { validatorDID } = this;
        const currentValidatorDID = this.currentValidatorDID.getIdentifier();

        const validatorLatestBlockInfo = await this._validatorContractExecutor.getLatestBlockInfoAsync();
        const { number } = validatorLatestBlockInfo;
        const { number: latestBlockNumber } = this.getLatestBlockInfo();
        if (latestBlockNumber < number) {
            this._logger.info(
                `Cannot propose self as validator because validator '${validatorDID}' is at block number ${number} while self is at ${latestBlockNumber}. Waiting for sync...`
            );
            return;
        }

        const validatorValidators = (await this._validatorContractExecutor.getValidatorsAsync()) || [];
        this._logger.info(`Received ${validatorValidators.length} validator(s) from '${validatorDID}'`, validatorValidators);

        const isSelfRegisteredInValidator = validatorValidators.some((validator) => validator.DID === currentValidatorDID);
        if (isSelfRegisteredInValidator) {
            this._logger.info(`Self is already part of the validator's '${this.validatorDID}' validator list`);

            this._logger.info(`Checking if self is part of self's validator list by getting local validators...`);
            const localValidators = await this.getLocalValidators();
            this._logger.debug(`Got ${localValidators.length} local validator(s),`, localValidators);
            const isSelfPresentInLocalValidators = localValidators.some((validator) => validator.DID === currentValidatorDID);
            if (isSelfPresentInLocalValidators) {
                this._logger.info(`Self is part of self's validator list. Synchronization completed.`);
                clearInterval(this._blockSyncInterval);
                this.onSyncFinished();
            }
        } else if (this._validatorProposalBlockNumber == null || this._validatorProposalBlockNumber < number) {
            this._logger.info(`Self is not part of the validator's '${this.validatorDID}' validators list. Sending proposal...`);

            const { currentValidatorURL } = this;

            try {
                const proposedValidator = {
                    DID: currentValidatorDID,
                    URL: currentValidatorURL,
                };
                await this._validatorContractExecutor.proposeValidatorAsync(proposedValidator);

                // we save the block number for when we send the validator proposal command, in order to check if it was accepted or not
                this._validatorProposalBlockNumber = number;

                this._logger.info(`Successfully proposed self as validator`);
            } catch (error) {
                this._logger.info(`Failed to propose self as validator to validator '${validatorDID}'`, error);
                throw error;
            }
        }
    }
}

module.exports = ValidatorSynchronizer;
