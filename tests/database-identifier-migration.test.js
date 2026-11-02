import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../src/database.js";
import { DEFAULT_WORKSPACE_ID, workspaceIdentifiers } from "../src/workspace-identifiers.js";

const identifiers = workspaceIdentifiers(DEFAULT_WORKSPACE_ID);
const legacyIdentifiers = workspaceIdentifiers("wuhe");
const current = {
  person: identifiers.personId,
  websiteChannel: identifiers.websiteChannelId,
  miniappChannel: identifiers.miniappChannelId,
  websiteDeployment: identifiers.websiteDeploymentId,
  miniappDeployment: identifiers.miniappDeploymentId,
  websiteSlug: identifiers.websitePublicSlug,
  miniappSlug: identifiers.miniappPublicSlug,
  websiteAssistantAccount: identifiers.websiteAssistantAccountId,
  miniappAssistantAccount: identifiers.miniappAssistantAccountId
};
const legacy = {
  person: legacyIdentifiers.personId,
  websiteChannel: legacyIdentifiers.websiteChannelId,
  miniappChannel: legacyIdentifiers.miniappChannelId,
  websiteDeployment: legacyIdentifiers.websiteDeploymentId,
  miniappDeployment: legacyIdentifiers.miniappDeploymentId,
  websiteSlug: legacyIdentifiers.websitePublicSlug,
  miniappSlug: legacyIdentifiers.miniappPublicSlug,
  websiteAssistantAccount: legacyIdentifiers.websiteAssistantAccountId,
  miniappAssistantAccount: legacyIdentifiers.miniappAssistantAccountId
};

function rewriteAccountId(db, from, to) {
  const references = [
    ["conversations", "account_id"], ["deliveries", "account_id"], ["channel_outbox", "account_id"],
    ["processed_events", "account_id"], ["state_machine_configs", "account_id"], ["flow_sessions", "account_id"],
    ["flow_state_events", "account_id"], ["tag_schemas", "account_id"], ["conversation_rule_tags", "account_id"],
    ["tag_events", "account_id"], ["activation_tasks", "account_id"], ["audit_logs", "account_id"],
    ["agent_usage_logs", "account_id"], ["channel_deployments", "account_id"], ["people", "config_account_id"],
    ["workspace_channels", "assistant_account_id"]
  ];
  for (const [table, column] of references) db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`).run(to, from);
  db.prepare("UPDATE channel_accounts SET id = ? WHERE id = ?").run(to, from);
}

function makeLegacyFixture(db) {
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.prepare("UPDATE channel_deployments SET person_id = ? WHERE person_id = ?").run(legacy.person, current.person);
    db.prepare("UPDATE channel_accounts SET person_id = ? WHERE person_id = ?").run(legacy.person, current.person);
    db.prepare("UPDATE people SET id = ? WHERE id = ?").run(legacy.person, current.person);

    for (const [from, to] of [[current.websiteChannel, legacy.websiteChannel], [current.miniappChannel, legacy.miniappChannel]]) {
      db.prepare("UPDATE channel_deployments SET workspace_channel_id = ? WHERE workspace_channel_id = ?").run(to, from);
      db.prepare("UPDATE channel_accounts SET workspace_channel_id = ? WHERE workspace_channel_id = ?").run(to, from);
      db.prepare("UPDATE workspace_channels SET id = ? WHERE id = ?").run(to, from);
    }

    for (const [from, to] of [[current.websiteDeployment, legacy.websiteDeployment], [current.miniappDeployment, legacy.miniappDeployment]]) {
      db.prepare("UPDATE channel_accounts SET deployment_id = ? WHERE deployment_id = ?").run(to, from);
      db.prepare("UPDATE channel_deployments SET id = ? WHERE id = ?").run(to, from);
    }
    db.prepare("UPDATE channel_deployments SET public_slug = ? WHERE public_slug = ?").run(legacy.websiteSlug, current.websiteSlug);
    db.prepare("UPDATE channel_deployments SET public_slug = ? WHERE public_slug = ?").run(legacy.miniappSlug, current.miniappSlug);

    rewriteAccountId(db, current.websiteAssistantAccount, legacy.websiteAssistantAccount);
    rewriteAccountId(db, current.miniappAssistantAccount, legacy.miniappAssistantAccount);
    db.prepare("UPDATE workspace_channels SET name = '伍合官网客服' WHERE id = ?").run(legacy.websiteChannel);
    db.prepare("UPDATE workspace_channels SET name = '伍合智能名片' WHERE id = ?").run(legacy.miniappChannel);
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

test("legacy workspace identifiers migrate from wuhe to the single dingmai source", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dclaw-identifier-migration-"));
  const filename = path.join(directory, "test.sqlite");
  let db = openDatabase(filename);
  makeLegacyFixture(db);
  db.close();

  db = openDatabase(filename);
  try {
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM people WHERE id = ?").get(current.person).count, 1);
    assert.deepEqual(
      db.prepare("SELECT id, name FROM workspace_channels ORDER BY provider").all().map((item) => ({ ...item })),
      [
        { id: current.miniappChannel, name: "顶脉智能名片" },
        { id: current.websiteChannel, name: "顶脉官网客服" }
      ]
    );
    assert.deepEqual(
      db.prepare("SELECT id, public_slug AS publicSlug FROM channel_deployments ORDER BY public_slug").all().map((item) => ({ ...item })),
      [
        { id: current.miniappDeployment, publicSlug: current.miniappSlug },
        { id: current.websiteDeployment, publicSlug: current.websiteSlug }
      ]
    );
    assert.deepEqual(
      db.prepare("SELECT id FROM channel_accounts WHERE id LIKE 'dingmai-%-company-assistant' ORDER BY id").all().map((item) => item.id),
      [current.miniappAssistantAccount, current.websiteAssistantAccount]
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM people WHERE id LIKE '%wuhe%'").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM workspace_channels WHERE id LIKE '%wuhe%'").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM channel_deployments WHERE id LIKE '%wuhe%' OR public_slug LIKE '%wuhe%'").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM channel_accounts WHERE id LIKE '%wuhe%'").get().count, 0);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
