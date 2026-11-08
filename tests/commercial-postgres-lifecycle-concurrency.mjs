import postgres from "postgres";
import assert from "node:assert/strict";

const rawUrl = process.env["COMMERCIAL_TEST_DATABASE_URL"];
if (!rawUrl) throw new Error("Set COMMERCIAL_TEST_DATABASE_URL to a disposable local commercial_test database.");
const target = new URL(rawUrl);
const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
if (target.protocol !== "postgres:" && target.protocol !== "postgresql:") throw new Error("Only PostgreSQL URLs are accepted.");
if (!localHosts.has(target.hostname.replace(/^\[|\]$/g, ""))) throw new Error("Refusing remote database hosts; commercial tests must run on loopback only.");
if (!target.pathname.toLowerCase().includes("commercial_test")) throw new Error("Database name must include commercial_test.");
if (/supabase|production|prod/i.test(`${target.hostname}/${target.pathname}`)) throw new Error("Refusing a production/Supabase target.");

const trialId = process.env["COMMERCIAL_TEST_EXPIRED_TRIAL_ID"];
const subscriptionId = process.env["COMMERCIAL_TEST_OVERDUE_SUBSCRIPTION_ID"];
if (!trialId || !subscriptionId) throw new Error("Provide pre-seeded trial and subscription fixture IDs in the disposable database.");
const sql = postgres(rawUrl, { max: 4, ssl: false, connect_timeout: 5, idle_timeout: 5 });
try {
  const [db] = await sql`select current_database() as name, inet_server_addr()::text as address, to_regprocedure('public.process_commercial_lifecycle(integer)')::text as worker`;
  assert.match(db.name, /commercial_test/i);
  assert.ok(!db.address || ["127.0.0.1", "::1"].includes(db.address), "PostgreSQL server address must be loopback");
  assert.ok(db.worker, "Apply migrations 0030–0033 before running this test.");

  const [trial] = await sql`select id,status,ends_at from public.account_trials where id=${trialId}`;
  const [subscription] = await sql`select id,status,grace_ends_at,external_id from public.account_subscriptions where id=${subscriptionId}`;
  assert.equal(trial?.status, "active");
  assert.ok(Date.parse(trial.ends_at) <= Date.now(), "Trial fixture must already be expired");
  assert.equal(subscription?.status, "past_due");
  assert.equal(subscription?.external_id, null, "Subscription fixture must not require external verification");
  assert.ok(Date.parse(subscription.grace_ends_at) <= Date.now(), "Subscription fixture grace period must be expired");

  // Separate PostgreSQL sessions race for the same eligible rows. SKIP LOCKED and row predicates
  // must leave one state transition and one audit row per fixture.
  await Promise.all([sql`select public.process_commercial_lifecycle(100)`, sql`select public.process_commercial_lifecycle(100)`]);
  const [afterTrial] = await sql`select status,expired_at from public.account_trials where id=${trialId}`;
  const [trialAudit] = await sql`select count(*)::int as n from public.commercial_trial_history where trial_id=${trialId} and operation='expired'`;
  const [afterSubscription] = await sql`select status from public.account_subscriptions where id=${subscriptionId}`;
  const [subscriptionAudit] = await sql`select count(*)::int as n from public.commercial_audit_log where account_id=(select account_id from public.account_subscriptions where id=${subscriptionId}) and operation='subscription_suspended' and after_state->>'subscription_id'=${subscriptionId}`;
  assert.equal(afterTrial.status, "expired");
  assert.ok(afterTrial.expired_at);
  assert.equal(trialAudit.n, 1);
  assert.equal(afterSubscription.status, "suspended");
  assert.equal(subscriptionAudit.n, 1);
  console.log("PostgreSQL lifecycle concurrency passed: concurrent trial expiry and delinquency suspension.");
} finally {
  await sql.end({ timeout: 5 });
}
