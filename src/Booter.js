class Booter {
    constructor(domain, domainConfig) {
        this.domain = domain;
        this.domainConfig = domainConfig;
    }

    async init() {
        const openDSU = require("opendsu");
        const resolver = openDSU.loadApi("resolver");

        const loadRawDossier = $$.promisify(resolver.loadDSU);

        this.rawDossier = await loadRawDossier(this.domainConfig.constitution);
        global.rawDossier = this.rawDossier;

        const contractConfigs = await this._getContractConfigs();

        this.bootContract = await this._loadBootContract(contractConfigs);

        this.contracts = {};

        for (let i = 0; i < contractConfigs.length; i++) {
            const contractConfig = contractConfigs[i];
            const contract = await this._loadContract(contractConfig);
            this.contracts[contractConfig.name] = contract;
        }

        if (this.bootContract) {
            this.bootContract.setContracts(this.contracts);
        }

        this.contractDescribeMethods = {};
        Object.keys(this.contracts).forEach((contractName) => {
            const contract = this.contracts[contractName];
            this.contractDescribeMethods[contractName] = contract.describeMethods ? contract.describeMethods() : null;
        });
    }

    describeMethodsForContract(contractName) {
        return this.contractDescribeMethods[contractName];
    }

    async _getContractConfigs() {
        const openDSU = require("opendsu");
        const { constants } = openDSU;

        const listFiles = $$.promisify(this.rawDossier.listFiles);
        const codeFolderFiles = await listFiles(constants.CODE_FOLDER);

        const contractConfigs = codeFolderFiles
            .filter((file) => file)
            .map((file) => file.split("/"))
            .filter((fileParts) => fileParts.length === 2 && fileParts[1].endsWith(".js"))
            .map((fileParts) => {
                return {
                    name: fileParts[0],
                    filePath: [constants.CODE_FOLDER, ...fileParts].join("/"),
                };
            });
        return contractConfigs;
    }

    async _loadBootContract(contractConfigs) {
        let bootContract;
        const bootContractConfig = contractConfigs.find((contract) => contract.name === "boot");
        if (bootContractConfig) {
            const bootContractIndex = contractConfigs.findIndex((contract) => contract === bootContractConfig);

            // remove the boot contract from contractConfigs in order to not be loaded again
            contractConfigs.splice(bootContractIndex, 1);

            try {
                const readFile = $$.promisify(this.rawDossier.readFile);
                const bootFileContent = await readFile(bootContractConfig.filePath);
                const BootClass = eval(`(${bootFileContent.toString()})`);
                bootContract = new BootClass(this.domain, this.domainConfig);
                await $$.promisify(bootContract.init.bind(bootContract))();
            } catch (e) {
                console.log("Failed to initialize boot", e);
                throw e;
            }
        }

        return bootContract;
    }

    async _loadContract(contractConfig) {
        let contract;
        const readFile = $$.promisify(this.rawDossier.readFile);
        var fileContent = await readFile(contractConfig.filePath);

        try {
            const ContractClass = eval(`(${fileContent.toString()})`);
            contract = new ContractClass();

            // ensure that all contract methods (invarious of how there are called) have "this" bound to the contract instance
            const classMethodNames = Object.getOwnPropertyNames(ContractClass.prototype).filter(
                (methodName) =>
                    methodName &&
                    methodName[0] !== "_" &&
                    methodName !== "constructor" &&
                    typeof ContractClass.prototype[methodName] === "function"
            );
            classMethodNames.forEach((methodName) => {
                contract[methodName] = contract[methodName].bind(contract);
            });

            if (this.bootContract) {
                // set mixin for each available contract with the help of the boot contract
                await $$.promisify(this.bootContract.setContractMixin.bind(this.bootContract))(contractConfig.name, contract);
            }

            // run initialization step if the init function is defined
            if (typeof contract.init === "function") {
                await $$.promisify(contract.init)();
            }

            return contract;
        } catch (e) {
            console.log("Failed to eval file", contractConfig.name, e);
            throw e;
        }
    }
}

function create(domain, domainConfig) {
    return new Booter(domain, domainConfig);
}

module.exports = {
    create,
};
