/*
A configurable consensus core that can have 3 consensus strategies
 - SVBC - Single Validator BrickLedger Consensus: imeditaly accepts a BrickBlock and treat it as a real Block 
 - MVBC - Multiple Validators BrickLedger Consensus: run the BrickLedger consensus between validators
 - OBAC - Other Blockchain Adapter Consensus: Delegates Consensus to an blockchain adapter that is using other blockchain tehnology to get consensus 
*/
