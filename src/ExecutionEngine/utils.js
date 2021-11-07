const w3cDID  = require('opendsu').loadApi('w3cdid');

async function validateNoncedCommandExecution(command, commandHistoryStorage, isValidatedMode) {
    // check if this nonced command has already been executed
    const commandHash = command.getHash();
    const isCommandRegistered = isValidatedMode
        ? await commandHistoryStorage.isOptimisticCommandHashRegistered(commandHash)
        : await commandHistoryStorage.isValidatedCommandHashRegistered(commandHash);
    if (isCommandRegistered) {
        throw new Error(`Command ${commandHash} hash already been executed`);
    }
}

async function markNoncedCommandAsExecuted(command, commandHistoryStorage, isValidatedMode) {
    if (isValidatedMode) {
        await commandHistoryStorage.addOptimisticComand(command);
    } else {
        await commandHistoryStorage.addValidatedComand(command);
    }
}

function getContractMethodExecutionPromise(command, contracts, keyValueStorage, commandHistoryStorage, isValidatedMode) {
    const { contractName, methodName, params } = command;
    const contract = contracts[contractName];
    let internalCommandsConsensusResult = false;

    const contractMethodExecutionPromise = new Promise(async (resolve, reject) => {
        const callback = $$.makeSaneCallback((error, result) => {
            if (error) {
                return reject(error);
            }
            resolve(result);
        });

        try {
            // initialize keyValueStorage
            await keyValueStorage.init();

            if (isValidatedMode) {
                keyValueStorage.enterValidatedMode(command.getHash());
            } else {
                keyValueStorage.enterOptimisticMode(command.getHash());
            }

            if (command.type === "nonced") {
                await validateNoncedCommandExecution(command, commandHistoryStorage, isValidatedMode);
                await markNoncedCommandAsExecuted(command, commandHistoryStorage, isValidatedMode);
            }

            // need to bind context to contract, in order to ensure that keyValueStorage is only used for this command
            // in order to properly detect if consensus is needed,
            // so we "extend" the contract and attach the keyValueStorage
            const context = { ...contract };
            const contractPrototype = Object.getPrototypeOf(contract);
            const classMethodNames = Object.getOwnPropertyNames(contractPrototype).filter(
                (methodName) => methodName && methodName !== "constructor" && typeof contractPrototype[methodName] === "function"
            );
            classMethodNames.forEach((methodName) => {
                if (methodName === 'deriveGetContractMethod') {
                    return;
                }
                context[methodName] = contract[methodName];
            });
            context.getContract = contract.deriveGetContractMethod((internalCommandResult) => {
                internalCommandsConsensusResult = internalCommandsConsensusResult || internalCommandResult.requireConsensus
            });
            
            context.keyValueStorage = keyValueStorage;

            contract[methodName].call(context, ...(params || []), callback);
        } catch (error) {
            callback(error);
        }
    });
    contractMethodExecutionPromise.requireConsensus = () => {
        return keyValueStorage.requireConsensus() || internalCommandsConsensusResult;
    }
    return contractMethodExecutionPromise;
}

async function getContractConfigs(rawDossier) {
    const listFiles = $$.promisify(rawDossier.listFiles);
    const contractsFolderPath = "/";
    const contractFiles = await listFiles(contractsFolderPath);

    const contractConfigs = contractFiles
        .filter((file) => file)
        .map((file) => file.split("/"))
        .filter((fileParts) => fileParts.length === 2 && fileParts[1].endsWith(".js"))
        .map((fileParts) => {
            return {
                name: fileParts[0],
                filePath: [contractsFolderPath, ...fileParts].join("/"),
            };
        });
    return contractConfigs;
}

async function loadContract(rawDossier, contractConfig) {
    let contract;
    const { name: contractName, filePath: contractFilePath } = contractConfig;
    const readFile = $$.promisify(rawDossier.readFile);
    var fileContent = await readFile(contractFilePath);

    try {
        const ContractClass = eval(`(${fileContent.toString()})`);
        contract = new ContractClass();

        // disabling the automatic context set in order for keyValueStorage consensus detection to work correctly
        // // ensure that all contract methods (invarious of how there are called) have "this" bound to the contract instance
        // const classMethodNames = Object.getOwnPropertyNames(ContractClass.prototype).filter(
        //     (methodName) =>
        //         methodName &&
        //         methodName[0] !== "_" &&
        //         methodName !== "constructor" &&
        //         typeof ContractClass.prototype[methodName] === "function"
        // );
        // classMethodNames.forEach((methodName) => {
        //     contract[methodName] = contract[methodName].bind(contract);
        // });

        return contract;
    } catch (e) {
        console.log("Failed to eval file", contractName, e);
        throw e;
    }
}

async function signAsContract(contractName, payload) {
    if (!contractName) {
        throw new Error('Contract name is required for signing');
    }
    const createIdentity = $$.promisify(w3cDID.createIdentity);
    const did = await createIdentity('contract', contractName);
    const sign = $$.promisify(did.sign);
    
    if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) {
        payload = JSON.stringify(payload);
    }

    const signature = await sign(payload);
    return {
        signer: did.getIdentifier(),
        signature
    }
}

async function validateSignature(signer, data, signature) {
    const resolveDID = $$.promisify(w3cDID.resolveDID);
    let did;
    
    try {
        did = await resolveDID(signer);
    } catch (e) {
        return false;
    }
    const verify = $$.promisify(did.verify);

    if (typeof data !== 'string' && !Buffer.isBuffer(data)) {
        data = JSON.stringify(data);
    }
    if (!Buffer.isBuffer(signature)) {
        const encoding = (!isNaN(parseInt(signature, 16))) ? 'hex' : 'ascii';
        signature = Buffer.from(signature, encoding);
    }
    return await verify(data, signature);
}

function setContractMixin(executionEngine, contractName, contract, consensusCore) {
    const contractNames = Object.keys(executionEngine.contracts)
        .filter((contractName) => !["test"].includes(contractName))
        .sort();

    const contractsMetadata = contractNames.map((contractName) => {
        const contract = executionEngine.contracts[contractName];
        const contractPrototype = Object.getPrototypeOf(contract);

        const contractMethodNames = Object.getOwnPropertyNames(contractPrototype).filter(
            (methodName) =>
                methodName &&
                methodName[0] !== "_" &&
                methodName !== "constructor" &&
                typeof contractPrototype[methodName] === "function"
        );

        return {
            name: contractName,
            methods: contractMethodNames,
        };
    });

    const getContractProxy = (contractName, afterContractMethodCall) => {
        // each contract can call only the "safe" methods from other contracts

        const describeMethodsForContract = executionEngine.describeMethodsForContract(contractName);
        const safeMethodNames = describeMethodsForContract ? describeMethodsForContract.safe : null;
        if (!safeMethodNames || !safeMethodNames.length) {
            // the desired contract doesn't have "safe" methods described
            // so no methods can be called
            return {};
        }

        const contractProxy = {};
        safeMethodNames.forEach((methodName) => {
            contractProxy[methodName] = async (...args) => {
                const params = args.slice(0, -1);
                const callback = args.pop();
                let error;
                let result;
                try {
                    result = await executionEngine.executeInternalCommand({
                        contractName,
                        methodName,
                        params,
                        type: 'safe'
                    });
                    
                    if (typeof afterContractMethodCall === 'function') {
                        try {
                            afterContractMethodCall(result);
                        } catch (e) {
                            console.error(afterContractMethodCall);
                        }
                    }
                } catch (e) {
                    error = e;
                }
                await callback(error, result);
            }
        });

        return contractProxy;
    };
    
    const contractPrototype = Object.getPrototypeOf(contract);

    contract.name = contractName;
    contract.domain = executionEngine.domain;
    contract.config = executionEngine.domainConfig;
    contract.rootFolder = executionEngine.rootFolder;
    contract.storageFolder = executionEngine.storageFolder;
    contract.getContractNames = () => contractNames;
    contract.getContractsMetadata = () => contractsMetadata;
    contract.deriveGetContractMethod = function (afterContractMethodCall) {
        return (contractName) => {
            return getContractProxy(contractName, afterContractMethodCall);
        }
    };
    
    // Ibject `isValidSignature` method only if it doesn't exist
    if (Object.getOwnPropertyNames(contractPrototype).indexOf('isValidSignature') === -1) {
        contract.isValidSignature = validateSignature
    }

    // Inject `sign` method only if it doesn't exist
    if (Object.getOwnPropertyNames(contractPrototype).indexOf('sign') === -1) {
        contract.sign = signAsContract;
    }

    // used for consensus when a validator is trying to get proposed pBlock from a given validator
    contract.getPBlockProposedForConsensus = consensusCore.getPBlockProposedForConsensus;
}

async function validateCommand(command, contracts, contractDescribeMethods, commandHistoryStorage) {
    const { contractName, methodName, params, type, blockNumber, timestamp, signerDID: signerDIDIdentifier } = command;

    if (!contractName || typeof contractName !== "string" || !contracts[contractName]) {
        throw `Unspecified or unkwnown contract '${contractName}'`;
    }

    const contract = contracts[contractName];

    if (!methodName || typeof methodName !== "string" || !contract[methodName]) {
        throw `Unspecified or unkwnown contract method '${methodName}' for contract '${contractName}'`;
    }

    if (params && !Array.isArray(params)) {
        throw `Unsupported params specified for method '${methodName}' for contract '${contractName}'`;
    }

    const contractMethodsInfo = contractDescribeMethods[contractName];
    if (!contractMethodsInfo) {
        throw `Missing describeMethods for contract '${contractName}'`;
    }

    if (type === "safe") {
        // check if current command is allowed to be called with executeSafeCommand
        const isSafeCallAllowedForMethod = contractMethodsInfo.safe && contractMethodsInfo.safe.includes(methodName);
        if (!isSafeCallAllowedForMethod) {
            throw `Method '${methodName}' for contract '${contractName}' cannot be called with executeSafeCommand`;
        }

        // safe command are called without nounce or signature
        return;
    }

    if (type === "nonced") {
        // check if current command is allowed to be called with executeNoncedCommand
        const isNoncedCallAllowedForMethod = contractMethodsInfo.nonced && contractMethodsInfo.nonced.includes(methodName);
        if (!isNoncedCallAllowedForMethod) {
            throw `Method '${methodName}' for contract '${contractName}' cannot be called with executeNoncedCommand`;
        }

        // for nonced methods we need to validate the timestamp and signature in order to run it
        if (blockNumber == null || !timestamp || !signerDIDIdentifier || typeof signerDIDIdentifier !== "string") {
            throw `Missing inputs required for signature validation`;
        }

        await command.validateSignature();

        // all validations for nonced command passed
        return;
    }

    throw `Unknown command type '${type}' specified`;
}

module.exports = {
    getContractMethodExecutionPromise,
    getContractConfigs,
    loadContract,
    setContractMixin,
    validateCommand,
    validateNoncedCommandExecution,
};
