class StorageValue {
    constructor(stringValue) {
        this.value = stringValue
            ? JSON.parse(stringValue)
            : {
                validated: null,
                pending: [],
            };
    }

    updateValidated(commandHash, validatedValue) {
        this.value.validated = validatedValue;
        const pendingCommandIndex = this.value.pending.findIndex((command) => command.commandHash === commandHash);
        if (pendingCommandIndex !== -1) {
            this.value.pending.splice(pendingCommandIndex, 1);
        }
        // log inconsistencies
    }

    addPending(commandHash, newValue) {
        this.value.pending.push({ commandHash, newValue });
    }

    asString() {
        return JSON.stringify(this.value);
    }

    /*
        if latest is false, return the validate value, otherwise get the latest
    */
    getValue(latest) {
        if (!latest) {
            return this.value.validated;
        }

        const { pending } = this.value;
        if (!pending.length) {
            // if there are no latest values so return the validated one
            return this.value.validated;
        }

        const latestValue = pending[pending.length - 1].newValue;
        return latestValue;
    }
}

module.exports = StorageValue;
