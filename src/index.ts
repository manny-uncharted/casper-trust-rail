/**
 * @veridex/casper-trust-rail
 *
 * Trust Rail — autonomous RWA oracle agents on Casper. On-chain identity +
 * accuracy-based reputation, sanctions-screened and cryptographically attested
 * data posts, settled via Casper-native x402.
 *
 * Built for the Casper Agentic Buildathon 2026.
 */

// Casper client
export * from './casper/types.js';
export { MockCasperRpc, type MockCasperRpcOptions } from './casper/MockCasperRpc.js';
export {
  CasperClient,
  type CasperClientOptions,
  type TrustRailContracts,
  type OracleFeedPoint,
} from './casper/CasperClient.js';
export {
  RealCasperRpc,
  type RealCasperRpcOptions,
  type CasperSigner,
} from './casper/RealCasperRpc.js';

// x402
export * from './x402/types.js';
export {
  ExactPaymentSigner,
  buildTransferTypedData,
  type PaymentSigner,
  type TypedData,
  type ExactPaymentSignerOptions,
} from './x402/ExactPaymentSigner.js';
export {
  CasperX402Facilitator,
  encodePaymentHeader,
  type CasperX402FacilitatorOptions,
  type FetchLike,
} from './x402/CasperX402Facilitator.js';

// Attestation
export * from './attestation/postAttestation.js';
export {
  createEd25519Attestation,
  Ed25519AttestationSigner,
  Ed25519AttestationVerifier,
} from './attestation/Ed25519Attestation.js';

// Oracle domain
export * from './oracle/TBillDataSource.js';
export * from './oracle/RiskAssessor.js';

// LLM (Gemini) — optional, powers the agent's risk-assessment brain
export { createGeminiComplete, geminiAvailable, type GeminiOptions } from './llm/gemini.js';
export {
  ReputationTracker,
  type ReputationTrackerOptions,
  type OutcomeScore,
  type LocalReputation,
} from './oracle/ReputationTracker.js';

// Sanctions
export * from './sanctions/screener.js';
export {
  StaticSanctionOracle,
  HttpSanctionOracle,
  type HttpSanctionOracleOptions,
} from './sanctions/StaticSanctionOracle.js';

// Agent
export { TrustRailAgent, type TrustRailAgentConfig } from './agent/TrustRailAgent.js';
export type { TrustRailPostResult, OutcomeRecord, SkipReason } from './agent/types.js';
