# bricksledger
bricksledger module put toghether  in a simple package  the code related to handling bricks and OpenDSU Ledger

# Development state
Latest updates are on the branch `dev`.
Dependecies version:
    - opendsu (branch: bricksledger-compatible)
    - apihub (branch: bricksledger-compatible)
    - bar (branch: bricksledger-compatible)
    - key-ssi-resolver (branch: bricksledger-compatible)
    
## Differences from `master` branch:
## Added
- `Bricksledger.executeInternalCommand()` - called when a contract calls another contract's method. Attempts to atomically execute code which depends on other contracts
- ACL support for contracts. A contract can define ACL rules which define what other contracts are authorized to call methods on it

## Changed
- The `CommandHistoryStorage` has been rewritten to prevent race conditions
- `Contract.getContract()` method has been rewritten to return an improved Proxy which allows easier access to the requested contract