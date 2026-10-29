import assert from "node:assert/strict";
import { test } from "node:test";
import {
  moveCmsDomain,
  inspectCmsDomainMove,
} from "../lib/allinkl-cms-move.mjs";

function fixture({ marker, currentPath = "/original", healthy = true } = {}) {
  const files = new Map();
  if (marker)
    files.set(
      "/cms/.lorzcms/domain-move.request.json",
      Buffer.from(JSON.stringify(marker)),
    );
  files.set(
    "/cms/config/local.php",
    Buffer.from(
      "<?php return ['base_url'=>'https://preview.example.de','dsn'=>'sqlite:private'];",
    ),
  );
  const mutations = [],
    writes = [],
    queries = [];
  const candidate = {
    source: { id: "source", domain: "live.example.de" },
    target: {
      id: "target",
      installation_id: "installation",
      base_url: "https://preview.example.de",
      version: "3.5.1",
      protocol: "ftp",
      host: "host",
      port: 21,
      username: "ftp",
      encrypted_credentials: "encrypted",
    },
    backupCommit: "a".repeat(40),
  };
  const transaction = {
    beginTransaction: async () => queries.push("begin"),
    commit: async () => queries.push("commit"),
    rollback: async () => queries.push("rollback"),
    release() {},
    query: async (sql, args) => {
      queries.push({ sql, args });
      return sql.startsWith("SELECT")
        ? [[{ site_id: "target", base_url: "https://preview.example.de" }]]
        : [[]];
    },
  };
  const args = {
    root: "/cms",
    hostname: "live.example.de",
    kasPublicPath: "/account/cms/public",
    currentPath,
    candidate,
    db: { getConnection: async () => transaction },
    remote: {
      exists: async (p) => files.has(p),
      read: async (p) => files.get(p),
      write: async (p, value) => {
        writes.push(p);
        files.set(p, value);
      },
    },
    kas: { call: async (...values) => mutations.push(values) },
    decrypt: () => ({ key: "1".repeat(64) }),
    request: async () => ({
      ok: true,
      json: async () => ({
        instanceId: healthy ? "installation" : "other",
        version: "3.5.1",
        installed: true,
      }),
    }),
  };
  return { args, files, writes, mutations, queries };
}
const intent = {
  format: "siteops-cms-domain-move-v1",
  hostname: "live.example.de",
  sourceSiteId: "source",
  installationId: "installation",
  expectedPreviousPath: "/original",
  targetPublicPath: "/account/cms/public",
};

test("managed domain move produces a concrete plan without writes", async () => {
  const f = fixture();
  const result = await moveCmsDomain(f.args);
  assert.equal(result.state, "planned");
  assert.deepEqual(result.request, intent);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.mutations, []);
  assert.deepEqual(f.queries, []);
});
test("mismatched or stale handoffs never alter hosting", async () => {
  for (const marker of [
    { ...intent, sourceSiteId: "unrelated" },
    { ...intent, installationId: "wrong" },
    { ...intent, targetPublicPath: "/different" },
    { ...intent, expectedPreviousPath: "/" },
  ]) {
    const f = fixture({ marker });
    await assert.rejects(moveCmsDomain(f.args), /Auftrag/);
    assert.deepEqual(f.mutations, []);
  }
  const f = fixture({ marker: intent, currentPath: "/changed-by-owner" });
  await assert.rejects(moveCmsDomain(f.args), /inzwischen/);
  assert.deepEqual(f.mutations, []);
});
test("unhealthy CMS blocks a directory change and does not leak credentials", async () => {
  const f = fixture({ marker: intent, healthy: false });
  await assert.rejects(moveCmsDomain(f.args), /nicht bereit/);
  assert.deepEqual(f.mutations, []);
  assert.deepEqual(f.writes, []);
});
test("switch stores a rollback record and waits for activation before metadata changes", async () => {
  const f = fixture({ marker: intent });
  const result = await moveCmsDomain(f.args);
  assert.equal(result.state, "pending_activation");
  assert.deepEqual(f.mutations, [
    [
      "update_subdomain",
      {
        subdomain_name: "live.example.de",
        subdomain_path: "/account/cms/public/",
      },
    ],
  ]);
  assert.ok(f.files.has("/cms/.lorzcms/domain-move.before.json"));
  assert.deepEqual(f.queries, []);
  assert.ok(!JSON.stringify(result).includes("encrypted"));
});
test("pending activation can be resumed without another KAS mutation", async () => {
  const f = fixture({
    marker: intent,
    currentPath: "/account/cms/public",
    healthy: false,
  });
  assert.equal((await moveCmsDomain(f.args)).state, "pending_activation");
  assert.deepEqual(f.mutations, []);
  assert.deepEqual(f.queries, []);
});
test("verified activation preserves source project identity and migrates CMS transactionally", async () => {
  const f = fixture({ marker: intent, currentPath: "/account/cms/public" });
  const result = await moveCmsDomain(f.args);
  assert.equal(result.state, "ready");
  assert.equal(result.siteId, "source");
  assert.equal(result.loginUrl, "https://live.example.de/admin/");
  assert.deepEqual(f.mutations, []);
  assert.ok(f.queries.includes("commit"));
  assert.match(
    f.files.get("/cms/config/local.php").toString(),
    /base_url'=>'https:\/\/live.example.de/,
  );
  assert.ok(
    f.queries.some(
      (q) =>
        q.sql?.startsWith("UPDATE cms_installations") && q.args[0] === "source",
    ),
  );
  assert.ok(
    f.queries.some(
      (q) => q.sql?.includes("enabled=0") && q.args[0] === "target",
    ),
  );
});
test("candidate detection rejects unbacked sources and mismatched deployment owners", async () => {
  for (const mode of ["no-backup", "wrong-owner"]) {
    const source = { id: "source", host: "host" };
    const target = {
      id: "target",
      installation_id: "installation",
      version: "3.5.1",
      base_url: "https://preview.example.de",
    };
    const db = {
      query: async (sql) =>
        sql.includes("JOIN cms_installations") && !sql.includes("LEFT JOIN")
          ? [[target]]
          : sql.includes("LEFT JOIN")
            ? [[source]]
            : [mode === "no-backup" ? [] : [{ git_commit: "a".repeat(40) }]],
    };
    const remote = {
      read: async (p) =>
        Buffer.from(
          JSON.stringify(
            p.endsWith("owner.json")
              ? { instanceId: "wrong" }
              : { version: "3.5.1" },
          ),
        ),
    };
    assert.equal(
      await inspectCmsDomainMove({
        db,
        remote,
        root: "/cms",
        connection: { host: "host" },
        hostname: "live.example.de",
      }),
      null,
    );
  }
});
