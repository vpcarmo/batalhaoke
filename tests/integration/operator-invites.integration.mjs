import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const url = process.env.OPERATOR_INVITES_TEST_DATABASE_URL;
if (!url)
  throw new Error(
    "Set OPERATOR_INVITES_TEST_DATABASE_URL to a disposable local PostgreSQL database.",
  );
const parsed = new URL(url);
if (
  !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname) ||
  !/invite.*test|test.*invite/i.test(parsed.pathname)
) {
  throw new Error(
    "Refusing non-local or non-test database; use a localhost database with 'invite' and 'test' in its name.",
  );
}

const sql = postgres(url, { max: 8, onnotice: () => {} });
const migration = await readFile(
  resolve("drizzle/migrations/0024_venue_operator_invites.sql"),
  "utf8",
);
const ids = {
  venue: "22222222-2222-4222-8222-222222222222",
  otherVenue: "33333333-3333-4333-8333-333333333333",
  owner: "11111111-1111-4111-8111-111111111111",
  operator: "44444444-4444-4444-8444-444444444444",
  user: "55555555-5555-4555-8555-555555555555",
  user2: "66666666-6666-4666-8666-666666666666",
};
const token = (char) => char.repeat(64);

async function invite({
  email = "operator@example.com",
  hash = token("a"),
  expires = "2099-01-01",
} = {}) {
  const [row] = await sql`
    insert into public.venue_operator_invites (venue_id,email_normalized,token_hash,invited_by,expires_at,delivery_state,sent_at)
    values (${ids.venue},${email},${hash},${ids.owner},${expires},'sent',now()) returning id
  `;
  return row.id;
}

before(async () => {
  await sql.unsafe(`
    create extension if not exists pgcrypto;
    do $$ begin
      create role anon nologin;
    exception when duplicate_object then null; end $$;
    do $$ begin
      create role authenticated nologin;
    exception when duplicate_object then null; end $$;
    do $$ begin
      create role service_role nologin bypassrls;
    exception when duplicate_object then null; end $$;
    create table if not exists public.venues (id uuid primary key, name text not null);
    create table if not exists public.accounts (id uuid primary key default gen_random_uuid());
    create table if not exists public.account_members (
      id uuid primary key default gen_random_uuid(), account_id uuid not null references public.accounts(id),
      user_id uuid not null, role text not null, unique(account_id,user_id)
    );
    create table if not exists public.venue_operators (
      id uuid primary key default gen_random_uuid(), venue_id uuid not null references public.venues(id) on delete cascade,
      user_id uuid not null, role text not null check (role in ('owner','operator')),
      unique(venue_id,user_id)
    );
    insert into public.venues(id,name) values
      ('${ids.venue}','Venue'),('${ids.otherVenue}','Other venue') on conflict do nothing;
    insert into public.accounts(id) values ('77777777-7777-4777-8777-777777777777') on conflict do nothing;
    insert into public.account_members(account_id,user_id,role) values
      ('77777777-7777-4777-8777-777777777777','${ids.owner}','owner') on conflict do nothing;
  `);
  await sql.unsafe("drop table if exists public.venue_operator_invites cascade");
  await sql.unsafe(migration);
  await sql`delete from public.venue_operators where venue_id in (${ids.venue},${ids.otherVenue})`;
  await sql`insert into public.venue_operators(venue_id,user_id,role) values
    (${ids.venue},${ids.owner},'owner'),(${ids.venue},${ids.operator},'operator'),(${ids.otherVenue},${ids.user2},'owner')`;
});

beforeEach(async () => {
  await sql`delete from public.venue_operator_invites`;
  await sql`delete from public.venue_operators where venue_id=${ids.venue} and user_id not in (${ids.owner},${ids.operator})`;
});

after(async () => {
  await sql`delete from public.venue_operator_invites`;
  await sql`delete from public.venue_operators where venue_id in (${ids.venue},${ids.otherVenue})`;
  await sql`delete from public.account_members where user_id = ${ids.owner}`;
  await sql`delete from public.accounts where id = '77777777-7777-4777-8777-777777777777'`;
  await sql`delete from public.venues where id in (${ids.venue},${ids.otherVenue})`;
  await sql.end();
});

test("migration constraints, indexes, RLS, grants, and unique pending invite", async () => {
  const [meta] =
    await sql`select rowsecurity from pg_tables where schemaname='public' and tablename='venue_operator_invites'`;
  assert.equal(meta.rowsecurity, true);
  assert.equal(
    await sql`select has_table_privilege('anon','public.venue_operator_invites','select') as ok`.then(
      (r) => r[0].ok,
    ),
    false,
  );
  assert.equal(
    await sql`select has_function_privilege('anon','public.accept_venue_operator_invite(text,uuid,text)','execute') as ok`.then(
      (r) => r[0].ok,
    ),
    false,
  );
  assert.equal(
    await sql`select has_function_privilege('authenticated','public.accept_venue_operator_invite(text,uuid,text)','execute') as ok`.then(
      (r) => r[0].ok,
    ),
    false,
  );
  assert.equal(
    await sql`select has_function_privilege('service_role','public.accept_venue_operator_invite(text,uuid,text)','execute') as ok`.then(
      (r) => r[0].ok,
    ),
    true,
  );
  for (const role of ["anon", "authenticated"]) {
    assert.equal(
      await sql`select has_function_privilege(${role},'public.claim_venue_operator_invite_resend(uuid,text,timestamptz,uuid)','execute') as ok`.then(
        (r) => r[0].ok,
      ),
      false,
    );
    assert.equal(
      await sql`select has_function_privilege(${role},'public.finish_venue_operator_invite_delivery(uuid,text,uuid,boolean)','execute') as ok`.then(
        (r) => r[0].ok,
      ),
      false,
    );
  }
  assert.equal(
    await sql`select has_function_privilege('service_role','public.claim_venue_operator_invite_resend(uuid,text,timestamptz,uuid)','execute') as ok`.then(
      (r) => r[0].ok,
    ),
    true,
  );
  await invite();
  await assert.rejects(
    invite({ hash: token("b") }),
    /venue_operator_invites_one_pending_per_email/,
  );
  await assert.rejects(
    sql`insert into public.venue_operator_invites (venue_id,email_normalized,token_hash,invited_by,expires_at) values (${ids.venue},'BAD',${token("c")},${ids.owner},'2099-01-01')`,
  );
});

test("two simultaneous claims have one winner and old claim UUID is fenced", async () => {
  const id = await invite({ hash: token("d") });
  let releaseLock;
  let acquired;
  const lockReady = new Promise((resolve) => {
    acquired = resolve;
  });
  const lockGate = new Promise((resolve) => {
    releaseLock = resolve;
  });
  const held = sql.begin(async (tx) => {
    await tx`select id from public.venue_operator_invites where id=${id} for update`;
    acquired();
    await lockGate;
  });
  await lockReady;
  const c1 = sql`select public.claim_venue_operator_invite_resend(${id},${token("e")},'2099-02-01','88888888-8888-4888-8888-888888888888') as claim`;
  const c2 = sql`select public.claim_venue_operator_invite_resend(${id},${token("f")},'2099-02-01','99999999-9999-4999-8999-999999999999') as claim`;
  await new Promise((resolve) => setTimeout(resolve, 50));
  releaseLock();
  const [a, b] = await Promise.all([c1, c2]);
  assert.equal([a[0].claim, b[0].claim].filter(Boolean).length, 1);
  await held;
  const current = (
    await sql`select token_hash,delivery_claim_id from public.venue_operator_invites where id=${id}`
  )[0];
  const old =
    current.delivery_claim_id === "88888888-8888-4888-8888-888888888888"
      ? "99999999-9999-4999-8999-999999999999"
      : "88888888-8888-4888-8888-888888888888";
  assert.equal(
    (
      await sql`select public.finish_venue_operator_invite_delivery(${id},${current.token_hash},${old},true) as ok`
    )[0].ok,
    false,
  );
});

test("expired sending lease is recoverable; expired invite and stale UUID cannot be claimed", async () => {
  const id = await invite({ hash: token("1") });
  await sql`update public.venue_operator_invites set delivery_state='sending', delivery_lease_until=now()-interval '1 minute' where id=${id}`;
  const result =
    await sql`select public.claim_venue_operator_invite_resend(${id},${token("2")},'2099-03-01','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') as claim`;
  assert.equal(result[0].claim, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  const stale =
    await sql`select public.finish_venue_operator_invite_delivery(${id},${token("1")},'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true) as ok`;
  assert.equal(stale[0].ok, false);
  await sql`update public.venue_operator_invites set expires_at=now()-interval '1 second' where id=${id}`;
  const expired =
    await sql`select public.claim_venue_operator_invite_resend(${id},${token("3")},'2099-04-01','cccccccc-cccc-4ccc-8ccc-cccccccccccc') as claim`;
  assert.equal(expired[0].claim, null);
});

test("failed delivery can be retried; completion requires a live matching claim", async () => {
  const id = await invite({ hash: token("4") });
  const claimId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  await sql`select public.claim_venue_operator_invite_resend(${id},${token("5")},'2099-05-01',${claimId})`;
  assert.equal(
    (
      await sql`select public.finish_venue_operator_invite_delivery(${id},${token("5")},${claimId},false) as ok`
    )[0].ok,
    true,
  );
  const retry =
    await sql`select public.claim_venue_operator_invite_resend(${id},${token("6")},'2099-06-01','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee') as claim`;
  assert.equal(retry[0].claim, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
  await sql`update public.venue_operator_invites set delivery_lease_until=now()-interval '1 second' where id=${id}`;
  assert.equal(
    (
      await sql`select public.finish_venue_operator_invite_delivery(${id},${token("6")},'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',true) as ok`
    )[0].ok,
    false,
  );
});

test("acceptance checks email, token, status and expiration, and adds only venue operator", async () => {
  const id = await invite({ hash: token("7") });
  const accept = (hash, user = ids.user, email = "operator@example.com") =>
    sql`select * from public.accept_venue_operator_invite(${hash},${user},${email})`;
  await assert.rejects(
    accept(token("7"), ids.user, "different@example.com"),
    /invite email mismatch/,
  );
  await assert.rejects(accept(token("8")), /invite is invalid or unavailable/);
  const result = await accept(token("7"));
  assert.equal(result[0].venue_id, ids.venue);
  assert.equal(result[0].role, "operator");
  await assert.rejects(accept(token("7"), ids.user2), /invite is invalid or unavailable/);
  assert.equal(
    (
      await sql`select count(*)::int as n from public.venue_operators where venue_id=${ids.venue} and user_id=${ids.user}`
    )[0].n,
    1,
  );
  assert.equal(
    (await sql`select count(*)::int as n from public.account_members where user_id=${ids.owner}`)[0]
      .n,
    1,
  );
  const expiredId = await invite({
    email: "expired@example.com",
    hash: token("9"),
    expires: "2000-01-01",
  });
  await assert.rejects(
    sql`select * from public.accept_venue_operator_invite(${token("9")},${ids.user},'expired@example.com')`,
    /invite is invalid or unavailable/,
  );
  await sql`update public.venue_operator_invites set status='cancelled',cancelled_at=now() where id=${expiredId}`;
  await assert.rejects(
    sql`select * from public.accept_venue_operator_invite(${token("9")},${ids.user},'expired@example.com')`,
    /invite is invalid or unavailable/,
  );
});

test("simultaneous accept uses independent connections and exactly one transaction wins", async () => {
  const id = await invite({ email: "race@example.com", hash: token("0") });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let ready = 0;
  const start = async (user) =>
    sql.begin(async (tx) => {
      ready += 1;
      if (ready === 2) release();
      await gate;
      return tx`select * from public.accept_venue_operator_invite(${token("0")},${user},'race@example.com')`;
    });
  const outcomes = await Promise.allSettled([start(ids.user), start(ids.user2)]);
  assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((x) => x.status === "rejected").length, 1);
  assert.equal(
    (
      await sql`select count(*)::int as n from public.venue_operators where venue_id=${ids.venue} and user_id in (${ids.user},${ids.user2})`
    )[0].n,
    1,
  );
});

test("operator membership and venue isolation remain separate from account_members", async () => {
  const id = await invite({ email: "scoped@example.com", hash: token("b") });
  const result =
    await sql`select * from public.accept_venue_operator_invite(${token("b")},${ids.user},'scoped@example.com')`;
  assert.equal(result[0].venue_id, ids.venue);
  assert.equal(
    (
      await sql`select count(*)::int as n from public.venue_operators where user_id=${ids.user} and venue_id=${ids.otherVenue}`
    )[0].n,
    0,
  );
  assert.equal(
    (await sql`select count(*)::int as n from public.account_members where user_id=${ids.user}`)[0]
      .n,
    0,
  );
  await sql`update public.venue_operator_invites set status='cancelled',cancelled_at=now() where id=${id}`;
});
