/**
 * One-off backfill: copy the winning merchant->category and merchant->icon
 * votes from the Appwrite `merchant_votes` / `icon_votes` collections into the
 * CloudKit *public* database (which, unlike the private DB, is writable with a
 * server-to-server key).
 *
 * Usage:
 *   node cloudkit/backfill-votes.mjs <keyID> <privateKeyPath> [environment]
 *   environment defaults to "production".
 *
 * Appwrite creds are read from .env / .env.local. The private key path and key
 * ID are passed as args and never committed.
 */
import crypto from 'crypto';
import fs from 'fs';
import https from 'https';
import { Client, Databases, Query } from 'node-appwrite';

const CONTAINER = 'iCloud.com.georgeoc.budgetapp';
const HOST = 'api.apple-cloudkit.com';

const [keyID, privateKeyPath, environmentArg] = process.argv.slice(2);
const environment = environmentArg || 'production';
if (!keyID || !privateKeyPath) {
  console.error('Usage: node cloudkit/backfill-votes.mjs <keyID> <privateKeyPath> [environment]');
  process.exit(2);
}
const privateKey = fs.readFileSync(privateKeyPath, 'utf8');

// ---- env ----
const env = {};
for (const f of ['.env', '.env.local']) {
  if (fs.existsSync(f)) for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// ---- CloudKit Web Services signed request ----
function ckPost(subpathTail, body) {
  const json = JSON.stringify(body);
  const path = `/database/1/${CONTAINER}/${environment}/public/${subpathTail}`;
  const date = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const bodyHash = crypto.createHash('sha256').update(json).digest('base64');
  const message = `${date}:${bodyHash}:${path}`;
  const signature = crypto.sign('sha256', Buffer.from(message, 'utf8'), privateKey).toString('base64');
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: HOST, method: 'POST', path,
        headers: {
          'Content-Type': 'application/json',
          'X-Apple-CloudKit-Request-KeyID': keyID,
          'X-Apple-CloudKit-Request-ISO8601Date': date,
          'X-Apple-CloudKit-Request-SignatureV1': signature,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(data)); } catch { resolve({}); }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(json);
    req.end();
  });
}

const shortHash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

// ---- read + aggregate Appwrite votes ----
async function readAll(db, dbId, col) {
  const out = [];
  let cursor = null;
  for (;;) {
    const q = [Query.limit(100)];
    if (cursor) q.push(Query.cursorAfter(cursor));
    const res = await db.listDocuments(dbId, col, q);
    out.push(...res.documents);
    if (res.documents.length < 100) break;
    cursor = res.documents[res.documents.length - 1].$id;
  }
  return out;
}

// pick winning value per merchant by summed vote count
function aggregate(docs, valueField) {
  const perMerchant = new Map(); // merchantKey -> { name, tally: Map<value, votes> }
  for (const d of docs) {
    const key = d.merchant_key;
    const val = d[valueField];
    if (!key || !val) continue;
    if (!perMerchant.has(key)) perMerchant.set(key, { name: d.merchant_name || key, tally: new Map() });
    const entry = perMerchant.get(key);
    entry.tally.set(val, (entry.tally.get(val) || 0) + (d.votes || 1));
  }
  const winners = [];
  for (const [key, { name, tally }] of perMerchant) {
    let top = '', topVotes = -1;
    for (const [val, votes] of tally) if (votes > topVotes) { topVotes = votes; top = val; }
    winners.push({ merchantKey: key, merchantName: name, value: top });
  }
  return winners;
}

function toRecord(recordType, prefix, valueFieldName, w) {
  return {
    operationType: 'forceReplace',
    record: {
      recordType,
      recordName: `${prefix}_backfill_${shortHash(w.merchantKey)}`,
      fields: {
        merchantKey: { value: w.merchantKey },
        merchantName: { value: w.merchantName },
        [valueFieldName]: { value: w.value },
        voterHash: { value: 'backfill' },
        updatedAt: { value: Date.now() },
      },
    },
  };
}

async function pushBatches(operations, label) {
  let ok = 0, fail = 0;
  for (let i = 0; i < operations.length; i += 100) {
    const chunk = operations.slice(i, i + 100);
    const res = await ckPost('records/modify', { operations: chunk });
    for (const r of res.records || []) {
      if (r.serverErrorCode || r.reason) { fail++; if (fail <= 3) console.log(`  ${label} error:`, r.serverErrorCode || r.reason); }
      else ok++;
    }
    process.stdout.write(`  ${label}: ${ok} ok, ${fail} failed\r`);
  }
  console.log(`\n  ${label}: ${ok} ok, ${fail} failed`);
}

// ---- run ----
const c = new Client().setEndpoint(env.EXPO_PUBLIC_APPWRITE_ENDPOINT).setProject(env.EXPO_PUBLIC_APPWRITE_PROJECT_ID).setKey(env.APPWRITE_API_KEY);
const db = new Databases(c);
const dbId = env.EXPO_PUBLIC_APPWRITE_DATABASE_ID;

console.log(`Backfilling into CloudKit ${environment} public DB (${CONTAINER})...`);

const merchantDocs = await readAll(db, dbId, env.EXPO_PUBLIC_APPWRITE_TABLE_MERCHANT_VOTES || 'merchant_votes');
const merchantWinners = aggregate(merchantDocs, 'category_id');
console.log(`Merchant votes: ${merchantDocs.length} docs -> ${merchantWinners.length} merchants`);
await pushBatches(merchantWinners.map((w) => toRecord('MerchantVote', 'mv', 'categoryId', w)), 'MerchantVote');

const iconDocs = await readAll(db, dbId, env.EXPO_PUBLIC_APPWRITE_TABLE_ICON_VOTES || 'icon_votes');
const iconWinners = aggregate(iconDocs, 'icon_url');
console.log(`Icon votes: ${iconDocs.length} docs -> ${iconWinners.length} merchants`);
await pushBatches(iconWinners.map((w) => toRecord('IconVote', 'iv', 'iconUrl', w)), 'IconVote');

console.log('Done.');
