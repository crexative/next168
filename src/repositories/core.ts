// Single seam to the pure core. TODO(#3): point these at src/core once S0-core lands.
export { migrateToCurrent, MigrationError, type MigrationContext } from './legacyMigration'
export { parseDocument, createEmptyDocument, type ParseResult } from './temporaryDocuments'
export { applyProposal, type ApplyResult } from './temporaryProposals'
