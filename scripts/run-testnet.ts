/**
 * Fully-functional LIVE demo against the deployed Casper testnet contracts.
 *
 * The agent's intelligence runs here in TypeScript — fetch the T-bill yield,
 * risk-assess it, sanctions-screen the beneficiary, and produce a signed
 * attestation bound to the exact value. The on-chain write is then executed
 * through the Odra livenet `interact` binary (the same proven path that deployed
 * the contracts), which registers the agent identity and posts the attested data
 * point to the reputation-gated oracle.
 *
 * Prereqs: contracts deployed (see DEPLOYED.md) and a funded key. Config comes
 * from `.env` (Bun auto-loads it). Run:
 *
 *   bun run scripts/run-testnet.ts
 */

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HeuristicRiskAssessor,
  OracleSanctionScreener,
  PostAttestationGuard,
  StaticSanctionOracle,
  StaticTBillDataSource,
  computePostIntentHash,
  createEd25519Attestation,
  signPostAttestation,
  toOnChainValue,
  type PostIntent,
} from '../src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const CONTRACTS_DIR = resolve(REPO_ROOT, 'contracts');

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env ${name} (see .env.example)`);
  return v;
}

function log(title: string): void {
  console.log(`\n=== ${title} ===`);
}

async function main(): Promise<void> {
  const network = 'casper:casper-test';
  const oracleHash = reqEnv('TRUSTRAIL_ORACLE_HASH');
  const identityHash = reqEnv('TRUSTRAIL_IDENTITY_HASH');
  const feedId = process.env.FEED_ID ?? 'us-3m-tbill';
  const agentId = process.env.TRUSTRAIL_AGENT_ID ?? 'veridex-tbill-oracle';
  const payTo = reqEnv('TRUSTRAIL_PAYTO');

  log('1. Fetch the RWA observation (off-chain)');
  const dataSource = new StaticTBillDataSource([
    {
      feedId,
      label: 'US 3-Month T-Bill',
      ratePercent: Number(process.env.RATE_PERCENT ?? '5.31'),
      asOf: new Date().toISOString(),
      source: 'US Treasury Daily Par Yield',
    },
  ]);
  const observation = await dataSource.fetch(feedId);
  const onChainValue = toOnChainValue(observation.ratePercent);
  console.log(`   ${observation.label}: ${observation.ratePercent}% -> on-chain value ${onChainValue}`);

  log('2. Risk assessment');
  const assessment = await new HeuristicRiskAssessor().assess(observation, { now: Date.now() });
  console.log(`   decision=${assessment.decision} risk=${assessment.riskScore} (${assessment.reasons.join('; ')})`);
  if (assessment.decision === 'escalate') {
    console.log('   ESCALATED — not posting.');
    return;
  }

  log('3. Sanctions screening (fail-closed)');
  const screener = new OracleSanctionScreener(new StaticSanctionOracle());
  const screening = await screener.screen({ id: `casper:${payTo}`, chain: network, address: payTo });
  console.log(`   verdict=${screening.verdict} (${screening.provider})`);
  if (screening.verdict === 'blocked') {
    console.log('   BLOCKED — not posting.');
    return;
  }

  log('4. Cryptographic attestation bound to the exact value');
  const intent: PostIntent = { chain: network, oracle: oracleHash, feedId, value: onChainValue.toString() };
  const intentHash = await computePostIntentHash(intent);
  const { signer, verifier } = createEd25519Attestation();
  const attestation = await signPostAttestation(
    {
      intentHash,
      verdict: 'allow',
      issuedAt: Date.now(),
      policyId: 'trust-rail/rwa-oracle@1',
      riskScore: assessment.riskScore,
    },
    signer,
  );
  const guard = new PostAttestationGuard({ verifier, mode: 'enforce' });
  const guardDecision = await guard.authorize({ intentHash, attestation });
  if (!guardDecision.allowed) {
    console.log(`   ATTESTATION DENIED: ${guardDecision.reasons.join('; ')}`);
    return;
  }
  console.log(`   attestation hash (stored on-chain): ${intentHash}`);

  log('5. Execute on-chain: register identity + post attested data point');
  await runInteract({
    identityHash,
    oracleHash,
    agentId,
    feedId,
    value: onChainValue.toString(),
    source: observation.source,
    attestationHash: intentHash,
  });
}

/** Spawn the Odra livenet `interact` binary to perform the on-chain write. */
function runInteract(args: {
  identityHash: string;
  oracleHash: string;
  agentId: string;
  feedId: string;
  value: string;
  source: string;
  attestationHash: string;
}): Promise<void> {
  const secretKey = resolve(REPO_ROOT, process.env.CASPER_SECRET_KEY_PEM ?? './contracts/keys/secret_key.pem');
  const nodeUrl = (process.env.ODRA_CASPER_LIVENET_NODE_ADDRESS ?? 'https://node.testnet.casper.network').replace(
    /\/rpc$/,
    '',
  );

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ODRA_CASPER_LIVENET_NODE_ADDRESS: nodeUrl,
    ODRA_CASPER_LIVENET_EVENTS_URL: process.env.ODRA_CASPER_LIVENET_EVENTS_URL ?? `${nodeUrl}/events`,
    ODRA_CASPER_LIVENET_CHAIN_NAME: process.env.CASPER_CHAIN_NAME ?? 'casper-test',
    ODRA_CASPER_LIVENET_SECRET_KEY_PATH: secretKey,
    TRUSTRAIL_IDENTITY_HASH: args.identityHash,
    TRUSTRAIL_ORACLE_HASH: args.oracleHash,
    TRUSTRAIL_AGENT_ID: args.agentId,
    FEED_ID: args.feedId,
    VALUE: args.value,
    SOURCE: args.source,
    ATTESTATION_HASH: args.attestationHash,
  };

  return new Promise((resolvePromise, reject) => {
    const child = spawn('cargo', ['run', '--quiet', '--bin', 'interact', '--features', 'livenet'], {
      cwd: CONTRACTS_DIR,
      env: childEnv,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`interact exited with code ${code}`)),
    );
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
