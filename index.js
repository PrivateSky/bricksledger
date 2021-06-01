function BricksLedger(myDID, booter, bbFactory, broadcaster, consensusCore, executionEngine, bricksStorage, keyValueStorage) {
    const { contracts } = booter;

    async function validateCommand(command, callback) {
        const {
            domain,
            contractName,
            methodName,
            params,
            type,
            nonce,
            requesterSignature,
            signerDID: signerDIDIdentifier,
        } = command;
        if (!contractName || typeof contractName !== "string" || !contracts[contractName]) {
            return callback(`Unspecified or unkwnown contract '${contractName}'`);
        }

        const contract = contracts[contractName];

        if (!methodName || typeof methodName !== "string" || !contract[methodName]) {
            return callback(`Unspecified or unkwnown contract method '${methodName}' for contract '${contractName}'`);
        }

        if (params && !Array.isArray(params)) {
            return callback(`Unsupported params specified for method '${methodName}' for contract '${contractName}'`);
        }

        const contractMethodsInfo = booter.describeMethodsForContract(contractName);
        if (!contractMethodsInfo) {
            return callback(`Missing describeMethods for contract '${contractName}'`);
        }

        // const isOnlyInternCallsAllowedForMethod = contractMethodsInfo.intern && contractMethodsInfo.intern.includes(method);
        // if (isOnlyInternCallsAllowedForMethod) {
        //     // intern methods cannot be called outside the worker
        //     return callback(
        //         `[contract-worker] Only intern calls are allowed for contract '${contractName}' and method '${method}'`
        //     );
        // }

        if (type === "safe") {
            // check if current command is allowed to be called with executeSafeCommand
            const isSafeCallAllowedForMethod = contractMethodsInfo.safe && contractMethodsInfo.safe.includes(methodName);
            if (!isSafeCallAllowedForMethod) {
                return callback(`Method '${methodName}' for contract '${contractName}' cannot be called with executeSafeCommand`);
            }

            // safe command are called without nounce or signature
            return callback();
        }

        if (type === "nonced") {
            // check if current command is allowed to be called with executeNoncedCommand
            const isNoncedCallAllowedForMethod = contractMethodsInfo.nonced && contractMethodsInfo.nonced.includes(method);
            if (!isNoncedCallAllowedForMethod) {
                return callback(
                    `Method '${methodName}' for contract '${contractName}' cannot be called with executeNoncedCommand`
                );
            }

            // for nonced methods we need to validate the nonce in order to run it
            if (!nonce || !signerDIDIdentifier || typeof signerDIDIdentifier !== "string") {
                return callback(`Missing inputs required for signature validation`);
            }

            // validate signature
            const paramsString = params ? JSON.stringify(params) : null;
            const fieldsToHash = [domain, contractName, methodName, paramsString, nonce].filter((x) => x != null);
            const hash = fieldsToHash.join(".");

            try {
                const w3cDID = require("opendsu").loadApi("w3cdid");
                const signerDID = await $$.promisify(w3cDID.resolveDID)(signerDIDIdentifier);
                const isValidSignature = await $$.promisify(signerDID.verify)(hash, requesterSignature);
                if (!isValidSignature) {
                    return callback("Invalid signature specified");
                }
            } catch (error) {
                return callback(error);
            }

            // validate nonce
            const consensusContract = contracts.consensus;
            if (!consensusContract) {
                return callback(`Missing consensus contract`);
            }

            const isValidNonce = await $$.promisify(consensusContract.validateNonce)(signerDIDIdentifier, nonce);
            if (!isValidNonce) {
                return callback(`Invalid nonce ${nonce} specified`);
            }

            // all validations for nonced command passed
            return callback();
        }

        return callback(`Unknown command type '${type}' specified`);
    }

    this.executeSafeCommand = async function (command, callback) {
        try {
            await $$.promisify(validateCommand)(command);

            const { contractName, methodName, params } = command;
            const contract = contracts[contractName];
            contract[methodName].call(contract, ...(params || []), callback);
        } catch (error) {
            callback(error);
        }
        // let executionResult = await executionEngine.executeMethodOptimistcally(command);
        // if (execution.requireConsensus()) {
        //     this.executeNoncedCommand(command, callback);
        // }
        // callback(undefined, executionResult);
    };

    this.executeNoncedCommand = async function (command, callback) {
        try {
            await $$.promisify(validateCommand)(command);

            const { contractName, methodName, params } = command;

            // run consensus
            const result = await $$.promisify(contracts.consensus.proposeCommand)(command);
            if (result) {
                const contract = contracts[contractName];
                return contract[methodName].call(contract, ...(params || []), callback);
            }

            return callback("[contract-worker] consensus wasn't reached");
        } catch (error) {
            callback(error);
        }
        // if (contracts.bdns.isValidator(myDID)) {
        //     bbFactory.addNoncedCommand(command);
        // } else {
        //     let validator = await contracts.bdns.chooseValidator();
        //     broadcaster.forwardCommand(validator, command, callback); //pass the command to an real validator
        // }
    };

    this.newBrickBlockFromNetwork = function (brickBlock) {
        consensusCore.addInConsensus(brickBlock);
    };
}

module.exports.initiliseBrickLedger = async function (domain, config, notificationHandler, callback) {
    try {
        let booter = require("./src/Booter.js").create(domain, config);
        await booter.init();

        let bricksStorage;
        let keyValueStorage;
        let bbFactory;
        let executionEngine;
        let consensusCore;
        let broadcaster;

        // let bricksStorage = require("./src/FSBricksStorage.js").create(domain, config);
        // let keyValueStorage = require("./src/FSKeyValueStorage.js").create(domain, config);
        // let bbFactory = require("./src/BrickBlocksFactory.js").create(domain);
        // let executionEngine = require("./src/ExecutionEngine.js").create(domain, notificationHandler);
        // let consensusCore = require("./src/ConsensusCore.js").create(domain);
        // let broadcaster = require("./src/broadcaster.js").create(domain);

        const bricksLedger = new BricksLedger(
            null,
            booter,
            bbFactory,
            broadcaster,
            consensusCore,
            executionEngine,
            bricksStorage,
            keyValueStorage
        );
        callback(null, bricksLedger);
    } catch (error) {
        callback(error);
    }
};

// if required, we could open the APIs later to customise these standard components
