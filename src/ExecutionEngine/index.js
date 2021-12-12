const Logger = require("../Logger");
const {
    getContractMethodExecutionPromise,
    getContractConfigs,
    loadContract,
    setContractMixin,
    validateCommand,
    validateInternalCommand,
    validateNoncedCommandExecution,
} = require("./utils");

const MAX_ALLOWED_NONCED_BLOCK_NUMBER_DIFF = 1;

class ExecutionEngine {
    constructor(domain, domainConfig, rootFolder, storageFolder, createFSKeyValueStorage, commandHistoryStorage) {
        this.domain = domain;
        this.domainConfig = domainConfig;
        this.rootFolder = rootFolder;
        this.storageFolder = storageFolder;
        this.createFSKeyValueStorage = createFSKeyValueStorage;
        this.commandHistoryStorage = commandHistoryStorage;
        this.commandExecuter = null;

        this._logger = new Logger(`[Bricksledger][${this.domain}][ExecutionEngine]`);
        this._logger.info("Create finished");
    }
    
    setCommandExecuter(executer) {
        this.commandExecuter = executer;
    }

    async loadContracts(pBlocksFactory) {
        const constitution = this.domainConfig && this.domainConfig.contracts ? this.domainConfig.contracts.constitution : null;
        if (!constitution) {
            throw new Error("Missing constitution");
        }

        this._logger.info("Loading contracts...");

        const openDSU = require("opendsu");
        const resolver = openDSU.loadApi("resolver");

        this._logger.debug(`Loading DSU ${constitution}...`);
        const loadRawDossier = $$.promisify(resolver.loadDSU);
        const rawDossier = await loadRawDossier(constitution);

        this._logger.debug("Loading contract configs...");
        const contractConfigs = await getContractConfigs(rawDossier);

        const contractNames = [];
        this.contracts = {};

        for (let i = 0; i < contractConfigs.length; i++) {
            const contractConfig = contractConfigs[i];
            contractNames.push(contractConfig.name);

            this._logger.debug(`Loading contract '${contractConfig.name}'...`);
            const contract = await loadContract(rawDossier, contractConfig);
            this.contracts[contractConfig.name] = contract;
        }

        this.contractDescribeMethods = {};
        this.contractACL = {};
        contractNames.forEach((contractName) => {
            const contract = this.contracts[contractName];
            this.contractDescribeMethods[contractName] = contract.describeMethods ? contract.describeMethods() : null;
            const contractACL = contract.acl ? contract.acl() : {};
            this.contractACL[contractName] = contractACL;
            this.contractDescribeMethods[contractName].protected = Object.values(contractACL.allow || {}).reduce((acc, item) => {
                for (const methodName of item) {
                    if (acc.indexOf(methodName) === -1) {
                        acc.push(methodName);
                    }
                }
                
                return acc;
            }, []);
        });

        // setup contract mixin and initialization
        for (let i = 0; i < contractNames.length; i++) {
            const contractName = contractNames[i];
            const contract = this.contracts[contractName];
            setContractMixin(this, contractName, contract, pBlocksFactory);

            // run initialization step if the init function is defined
            if (typeof contract.init === "function") {
                this._logger.debug(`Initializing contract '${contractName}'...`);
                // need to bind context to contract
                await $$.promisify(contract.init.bind(contract))();
            }
        }

        this._logger.info("Loading contracts finished");
    }

    async validateSafeCommand(command) {
        if (this.domain !== command.domain) {
            throw new Error(`Invalid domain '${command.domain}' specified`);
        }
        await validateCommand(command, this.contracts, this.contractDescribeMethods);
    }

    async validateInternalCommand(command) {
        if (this.domain !== command.domain) {
            throw new Error(`Invalid domain '${command.domain}' specified`);
        }
        await validateInternalCommand(command, this.contracts, this.contractDescribeMethods, this.commandHistoryStorage);
    }

    async validateNoncedCommand(command, currentBlockNumber) {
        if (this.domain !== command.domain) {
            throw new Error(`Invalid domain '${command.domain}' specified`);
        }

        await validateCommand(command, this.contracts, this.contractDescribeMethods);

        this._logger.debug(`[nonced-command-${command.getHash()}] validating nonced command execution...`);
        await validateNoncedCommandExecution(command, this.commandHistoryStorage);

        const { blockNumber } = command;
        const isValidBlockNumber =
            blockNumber === currentBlockNumber ||
            (currentBlockNumber > blockNumber && currentBlockNumber - blockNumber <= MAX_ALLOWED_NONCED_BLOCK_NUMBER_DIFF);
        if (!isValidBlockNumber) {
            throw new Error(`Provided blockNumber ${blockNumber} is much older than the current block ${currentBlockNumber}`);
        }
    }

    describeMethodsForContract(contractName) {
        return this.contractDescribeMethods[contractName];
    }
    
    getContractACL(contractName) {
        return this.contractACL[contractName];
    }
    
    executeMethodOptimistically(command) {
        const { contractName } = command;

        const keyValueStorage = this.createFSKeyValueStorage(contractName);
        const contractMethodExecutionPromise = getContractMethodExecutionPromise(
            command,
            this.contracts,
            keyValueStorage,
            this.commandHistoryStorage
        );

        const executionResult = {
            requireConsensus: () => contractMethodExecutionPromise.then(() => contractMethodExecutionPromise.requireConsensus()),
            getOptimisticExecutionResult: () => contractMethodExecutionPromise,
        };

        return executionResult;
    }

    async executePBlock(pBlock) {
        this._logger.debug(`Executing pBlock '${pBlock.hashLinkSSI}'...`);
        try {
            const { commands } = pBlock;
            for (let i = 0; i < commands.length; i++) {
                const command = commands[i];
                const { contractName } = command;

                const keyValueStorage = this.createFSKeyValueStorage(contractName);
                await getContractMethodExecutionPromise(
                    command,
                    this.contracts,
                    keyValueStorage,
                    this.commandHistoryStorage,
                    true
                );
            }
        } catch (error) {
            throw error;
        }
    }
    
    async executeInternalCommand(command) {
        if (typeof this.commandExecuter === 'undefined') {
            throw new Error("The execution engine needs to have a reference to the Bricksledger in order to execute commands from a smart contract");
        }
        
        return new Promise(async (resolve, reject) => {
            command = this.commandExecuter.createCommand({
                ...command,
                domain: this.domain
            });
            await this.commandExecuter.execute(command, async (error, executionPromise) => {;
                if (error) {
                    return reject(error);
                }

                try {
                    const requireConsensus = await executionPromise.requireConsensus();
                    const result = await executionPromise.getOptimisticExecutionResult();
                    
                    resolve({
                        requireConsensus,
                        optimisticResult: result,
                        validatedResult: requireConsensus ? result : null
                    });
                } catch (e) {
                    return reject(e);
                }
                
            });
        });
    }
}

function create(...args) {
    return new ExecutionEngine(...args);
}

module.exports = {
    create,
};
