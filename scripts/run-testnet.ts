/**
 * Drive the Trust Rail agent against Casper **testnet**.
 *
 * Prerequisites:
 *  1. Build + deploy the three contracts (see README "Deploy to testnet"):
 *       cd contracts && cargo odra build
 *       # put-deploy each wasm, note the contract hashes
 *  2. Fund the agent key with testnet CSPR from the faucet.
 *  3. Export the env below, then:
 *       bun run scripts/run-testnet.ts
 *
 * Env:
 *   CASPER_NODE_URL          e.g. https://node.testnet.cspr.cloud/rpc
 *   CASPER_CHAIN_NAME        casper-test
 *   CASPER_SECRET_KEY_PEM    path to the agent's ed25519 secret_key.pem
 *   CSPR_CLOUD_ACCESS_TOKEN  (optional) CSPR.cloud bearer token
 *   TRUSTRAIL_IDENTITY_HASH  hash-... of the deployed AgentIdentity contract
 *   TRUSTRAIL_REPUTATION_HASH hash-... of the deployed Reputation contract
 *   TRUSTRAIL_ORACLE_HASH    hash-... of the deployed RwaOracle contract
 *   TRUSTRAIL_AGENT_ID       on-chain agent id (default "veridex-tbill-oracle")
 *   TRUSTRAIL_PAYTO          beneficiary account hash (screened before posting)
 */

import { readFileSync } from 'node:fs';
import {
  CasperClient,
  HttpTBillDataSource,
  RealCasperRpc,
  StaticSanctionOracle,
  OracleSanctionScreener,
  TrustRailAgent,
  createEd25519Attestation,
  type TBillObservation,
} from '../src/index.js';


function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env ${name}`);
  return v;
}

/** US Treasury "Daily Treasury Par Yield Curve" JSON → observation. */
function treasuryParser(raw: unknown, feedId: string): TBillObservation {
  // The Treasury fiscaldata API returns { data: [{ record_date, ... }] }.
  const rec = (raw as { data?: Array<Record<string, string>> }).data?.[0] ?? {};
  const rate = Number(rec.avg_interest_rate_amt ?? rec.security_desc ?? '0');
  return {
    feedId,
    label: 'US 3-Month T-Bill',
    ratePercent: Number.isFinite(rate) ? rate : 0,
    asOf: rec.record_date ?? new Date().toISOString(),
    source: 'US Treasury fiscaldata',
  };
}

async function main(): Promise<void> {
  const rpc = new RealCasperRpc({
    nodeUrl: reqEnv('CASPER_NODE_URL'),
    network: 'casper-test',
    chainName: process.env.CASPER_CHAIN_NAME ?? 'casper-test',
    signer: { secretKeyPem: readFileSync(reqEnv('CASPER_SECRET_KEY_PEM'), 'utf8') },
    ...(process.env.CSPR_CLOUD_ACCESS_TOKEN
      ? { accessToken: process.env.CSPR_CLOUD_ACCESS_TOKEN }
      : {}),
  });

  const casper = new CasperClient(rpc, {
    identity: reqEnv('TRUSTRAIL_IDENTITY_HASH'),
    reputation: reqEnv('TRUSTRAIL_REPUTATION_HASH'),
    oracle: reqEnv('TRUSTRAIL_ORACLE_HASH'),
  });

  const dataSource = new HttpTBillDataSource({
    url: 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates?sort=-record_date&page[size]=1',
    parser: treasuryParser,
  });

  const screener = new OracleSanctionScreener(new StaticSanctionOracle());
  const { signer, verifier } = createEd25519Attestation();

  const agentId = process.env.TRUSTRAIL_AGENT_ID ?? 'veridex-tbill-oracle';
  const agent = new TrustRailAgent({
    agentId,
    network: 'casper:casper-test',
    payTo: reqEnv('TRUSTRAIL_PAYTO'),
    casper,
    dataSource,
    screener,
    attestationSigner: signer,
    attestationVerifier: verifier,
  });

  console.log('registering identity on testnet...');
  console.log(await agent.registerIdentity(`did:casper:${agentId}`));

  console.log('running oracle pipeline against testnet...');
  const result = await agent.runOnce('us-3m-tbill');
  console.log(JSON.stringify({ posted: result.posted, deployHash: result.deployHash, explorerUrl: result.explorerUrl, notes: result.notes }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
