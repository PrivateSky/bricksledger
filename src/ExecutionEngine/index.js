const {
    getContractMethodExecutionPromise,
    getContractConfigs,
    loadContract,
    setContractMixin,
    validateCommand,
} = require("./utils");

const MAX_ALLOWED_NONCED_BLOCK_NUMBER_DIFF = 1;

class ExecutionEngine {
    constructor(domain, domainConfig, rootFolder, createFSKeyValueStorage, commandHistoryStorage, notificationHandler) {
        this.domain = domain;
        this.domainConfig = domainConfig;
        this.rootFolder = rootFolder;
        this.createFSKeyValueStorage = createFSKeyValueStorage;
        this.commandHistoryStorage = commandHistoryStorage;
        this.notificationHandler = notificationHandler;
    }

    async loadContracts() {
        const openDSU = require("opendsu");
        const resolver = openDSU.loadApi("resolver");

        const loadRawDossier = $$.promisify(resolver.loadDSU);
        const rawDossier = await loadRawDossier(this.domainConfig.contracts.constitution);

        const contractConfigs = await getContractConfigs(rawDossier);

        const contractNames = [];
        this.contracts = {};

        for (let i = 0; i < contractConfigs.length; i++) {
            const contractConfig = contractConfigs[i];
            contractNames.push(contractConfig.name);

            const contract = await loadContract(rawDossier, contractConfig);
            this.contracts[contractConfig.name] = contract;
        }

        this.contractDescribeMethods = {};
        contractNames.forEach((contractName) => {
            const contract = this.contracts[contractName];
            this.contractDescribeMethods[contractName] = contract.describeMethods ? contract.describeMethods() : null;
        });

        // setup contract mixin and initialization
        for (let i = 0; i < contractNames.length; i++) {
            const contractName = contractNames[i];
            const contract = this.contracts[contractName];
            setContractMixin(this, contractName, contract);

            // run initialization step if the init function is defined
            if (typeof contract.init === "function") {
                await $$.promisify(contract.init)();
            }
        }
    }

    async validateSafeCommand(command) {
        if (this.domain !== command.domain) {
            throw new Error(`Invalid domain '${command.domain}' specified`);
        }
        await validateCommand(command, this.contracts, this.contractDescribeMethods, this.commandHistoryStorage);
    }

    async validateNoncedCommand(command, currentBlockNumber) {
        if (this.domain !== command.domain) {
            throw new Error(`Invalid domain '${command.domain}' specified`);
        }

        await validateCommand(command, this.contracts, this.contractDescribeMethods, this.commandHistoryStorage);
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

    executeMethodOptimistically(command) {
        const { contractName } = command;

        const keyValueStorage = this.createFSKeyValueStorage(contractName);
        const contractMethodExecutionPromise = getContractMethodExecutionPromise(command, this.contracts, keyValueStorage);

        const executionResult = {
            requireConsensus: () => contractMethodExecutionPromise.then(() => keyValueStorage.requireConsensus()),
            getOptimisticExecutionResult: () => contractMethodExecutionPromise,
        };

        return executionResult;
    }

    async executePBlock(pBlock) {
        try {
            const { commands } = pBlock;
            for (let i = 0; i < commands.length; i++) {
                const command = commands[i];
                const { contractName } = command;

                const keyValueStorage = this.createFSKeyValueStorage(contractName);
                await getContractMethodExecutionPromise(command, this.contracts, keyValueStorage);
            }
        } catch (error) {
            throw error;
        }
    }
}

function create(domain, domainConfig, rootFolder, createFSKeyValueStorage, commandHistoryStorage, notificationHandler) {
    return new ExecutionEngine(
        domain,
        domainConfig,
        rootFolder,
        createFSKeyValueStorage,
        commandHistoryStorage,
        notificationHandler
    );
}

module.exports = {
    create,
};
