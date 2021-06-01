class Booter {
    constructor(domain, config) {
        this.domain = domain;
        this.config = config;
    }

    async init() {
        const openDSU = require("opendsu");
        const resolver = openDSU.loadApi("resolver");

        const loadRawDossier = $$.promisify(resolver.loadDSU);

        this.rawDossier = await loadRawDossier(this.config.constitution);
        global.rawDossier = this.rawDossier;

        const contractConfigs = await this._getContractConfigs();

        this.contracts = {};

        for (let i = 0; i < contractConfigs.length; i++) {
            const contractConfig = contractConfigs[i];
            const contract = await this._loadContract(contractConfig);
            this.contracts[contractConfig.name] = contract;
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

            this._setContractMixin(contract);

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

    _setContractMixin(contract) {
        contract.domain = this.domain;
        contract.config = this.config;
        contract.getDSU = () => this.rawDossier;
        contract.getContract = (contractName) => this.contracts[contractName];
        contract.getContractNames = () => Object.keys(this.contracts).sort();
    }
}

function create(domain, config) {
    return new Booter(domain, config);
}

module.exports = {
    create,
};
