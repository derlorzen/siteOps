import { createHash, randomUUID } from 'node:crypto';
import * as z from 'zod/v4';
import { isBlockedExecutable, isBlockedToken } from './coolify-blacklist.mjs';

// Restricted "terminal": only commands that an administrator put on an allowlist can run, and only
// through Coolify's own scheduled-task API. No shell, no SSH, no Docker socket.

const uuid = z.uuid();
const resourceId = z.string().regex(/^[a-zA-Z0-9_-]{4,191}$/);
const commandKey = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/);

// Every token is limited to a character set without any shell metacharacters, quotes, spaces or `$`.
const TOKEN = /^[A-Za-z0-9_.:=@/+-]{1,120}$/;
// The executable must be a plain name: a leading `VAR=value` is a shell assignment that makes the
// shell run the next token, so it is not accepted as a first token.
const EXECUTABLE = /^[A-Za-z][A-Za-z0-9_.+-]*$/;
const MAX_TOKENS = 12;
const MAX_ARGS = 8;
const MAX_COMMAND_LENGTH = 300;
const TASK_FREQUENCY = '0 0 1 1 *';
const TASK_TIMEOUT = 120;
const POLL_ATTEMPTS = 12;
const POLL_INTERVAL_MS = 2000;
const MAX_MESSAGE = 4000;
const MAX_LOG_CHARS = 20000;

function tokensOf(value) {
  return String(value).trim().split(/ +/).filter(Boolean);
}

function checkTokens(tokens, label) {
  for (const token of tokens) {
    if (!TOKEN.test(token) || token.includes('..'))
      throw Object.assign(
        new Error(label + ': nur Buchstaben, Ziffern und _ . : = @ / + - erlaubt, keine Sonderzeichen.'),
        { statusCode: 400 }
      );
    if (isBlockedToken(token))
      throw Object.assign(new Error(label + ': "' + token + '" steht auf der Blacklist und wird nie ausgeführt.'), {
        statusCode: 400
      });
  }
}

export function validateCommand(command) {
  const text = String(command).trim();
  const tokens = tokensOf(text);
  if (!tokens.length || tokens.length > MAX_TOKENS || text.length > MAX_COMMAND_LENGTH)
    throw Object.assign(new Error('Befehl leer oder zu lang.'), { statusCode: 400 });
  if (isBlockedExecutable(tokens[0]))
    throw Object.assign(new Error('Befehl "' + tokens[0] + '" steht auf der Blacklist und wird nie ausgeführt.'), {
      statusCode: 400
    });
  if (!EXECUTABLE.test(tokens[0]))
    throw Object.assign(new Error('Befehl "' + tokens[0] + '" ist nicht erlaubt.'), { statusCode: 400 });
  checkTokens(tokens, 'Befehl');
  return tokens.join(' ');
}

export function validateArgs(args) {
  if (args.length > MAX_ARGS) throw Object.assign(new Error('Zu viele Argumente.'), { statusCode: 400 });
  checkTokens(args, 'Argument');
  return args;
}

export const coolifyCommandDefineSchema = z.object({
  connectionId: uuid,
  applicationUuid: resourceId,
  commandKey,
  label: z.string().trim().min(2).max(190),
  command: z.string().trim().min(1).max(MAX_COMMAND_LENGTH),
  container: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/)
    .optional(),
  allowArgs: z.boolean().default(false)
});

export const coolifyCommandRunSchema = z.object({
  connectionId: uuid,
  applicationUuid: resourceId,
  commandKey,
  args: z.array(z.string().trim().min(1).max(120)).max(MAX_ARGS).default([])
});

export const coolifyLogsSchema = z.object({
  connectionId: uuid,
  applicationUuid: resourceId,
  lines: z.number().int().min(1).max(500).default(100),
  serviceName: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/)
    .optional()
});

export const coolifyRestartSchema = z.object({ connectionId: uuid, applicationUuid: resourceId });

const digest = value => createHash('sha256').update(value).digest('hex');
const safeList = (value, name) => {
  if (!Array.isArray(value)) throw new Error('Coolify ' + name + ': ungültige API-Antwort.');
  return value;
};
// A reused task must still match exactly what SiteOps created: it is disabled and yearly, so it
// never fires on its own, and it runs the fixed command in the expected container with our timeout.
const taskMatches = (task, command, container) =>
  task.command === command &&
  (task.container || '') === (container || '') &&
  task.frequency === TASK_FREQUENCY &&
  Number(task.timeout) === TASK_TIMEOUT &&
  !(task.enabled === true || task.enabled === 1 || task.enabled === '1' || task.enabled === 'true');
const redact = text => String(text || '').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
const publicCommand = row => ({
  id: row.id,
  connectionId: row.connection_id,
  applicationUuid: row.application_uuid,
  commandKey: row.command_key,
  label: row.label,
  command: row.command,
  container: row.container || null,
  allowArgs: Boolean(row.allow_args)
});

export function createCoolifyExecService({
  db,
  loadConnection,
  makeClient,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
}) {
  async function getClient(connectionId) {
    return makeClient(await loadConnection(uuid.parse(connectionId)));
  }
  async function ownedApplication(api, applicationUuid) {
    const apps = safeList(await api.applications(), 'Anwendungen');
    if (!apps.some(item => item.uuid === applicationUuid))
      throw Object.assign(new Error('Anwendung nicht in dieser Coolify-Verbindung gefunden.'), { statusCode: 404 });
  }

  // Serialize runs per task, so two callers can never be handed the same Coolify execution.
  async function withLock(identity, work) {
    const lock = await db.getConnection();
    const lockName = 'siteops:ce:' + digest(identity).slice(0, 40);
    let acquired = false;
    try {
      const [[result]] = await lock.query('SELECT GET_LOCK(?, 40) AS acquired', [lockName]);
      if (!result?.acquired)
        throw Object.assign(new Error('Derselbe Befehl läuft bereits. Bitte später erneut versuchen.'), {
          statusCode: 409
        });
      acquired = true;
      return await work();
    } finally {
      try {
        if (acquired) await lock.query('SELECT RELEASE_LOCK(?)', [lockName]);
      } finally {
        lock.release();
      }
    }
  }

  async function listCommands({ connectionId, applicationUuid }) {
    const params = [uuid.parse(connectionId)];
    let sql = 'SELECT * FROM coolify_commands WHERE connection_id=?';
    if (applicationUuid) {
      sql += ' AND application_uuid=?';
      params.push(resourceId.parse(applicationUuid));
    }
    const [rows] = await db.query(sql + ' ORDER BY application_uuid, command_key', params);
    return rows.map(publicCommand);
  }

  // Administrative: reachable only through the authenticated dashboard API, never through MCP tools.
  async function defineCommand(raw) {
    const x = coolifyCommandDefineSchema.parse(raw);
    const command = validateCommand(x.command);
    await loadConnection(x.connectionId);
    const id = randomUUID();
    try {
      await db.query(
        'INSERT INTO coolify_commands(id,connection_id,application_uuid,command_key,label,command,container,allow_args) VALUES(?,?,?,?,?,?,?,?)',
        [
          id,
          x.connectionId,
          x.applicationUuid,
          x.commandKey,
          x.label,
          command,
          x.container || null,
          x.allowArgs ? 1 : 0
        ]
      );
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY')
        throw Object.assign(new Error('Befehlsschlüssel existiert für diese Anwendung bereits.'), { statusCode: 409 });
      throw error;
    }
    return publicCommand({
      id,
      connection_id: x.connectionId,
      application_uuid: x.applicationUuid,
      command_key: x.commandKey,
      label: x.label,
      command,
      container: x.container,
      allow_args: x.allowArgs
    });
  }

  async function deleteCommand(id) {
    const [result] = await db.query('DELETE FROM coolify_commands WHERE id=?', [uuid.parse(id)]);
    if (!result.affectedRows) throw Object.assign(new Error('Befehl nicht gefunden.'), { statusCode: 404 });
    return { deleted: true };
  }

  async function runCommand(raw) {
    const x = coolifyCommandRunSchema.parse(raw);
    const [rows] = await db.query(
      'SELECT * FROM coolify_commands WHERE connection_id=? AND application_uuid=? AND command_key=? LIMIT 1',
      [x.connectionId, x.applicationUuid, x.commandKey]
    );
    if (!rows.length)
      throw Object.assign(new Error('Befehl steht nicht auf der Allowlist dieser Anwendung.'), { statusCode: 403 });
    const entry = rows[0];
    if (x.args.length && !entry.allow_args)
      throw Object.assign(new Error('Dieser Befehl erlaubt keine Argumente.'), { statusCode: 400 });
    const args = validateArgs(x.args);
    // Re-validate the stored command in case the allowlist was written before a rule tightened.
    const full = [validateCommand(entry.command), ...args].join(' ');
    const api = await getClient(x.connectionId);
    await ownedApplication(api, x.applicationUuid);
    const runId = randomUUID();
    // The audit row stores the key and the number of arguments, never the argument values.
    await db.query(
      'INSERT INTO coolify_command_runs(id,connection_id,application_uuid,command_key,arg_count) VALUES(?,?,?,?,?)',
      [runId, x.connectionId, x.applicationUuid, x.commandKey, args.length]
    );
    const finish = state => db.query('UPDATE coolify_command_runs SET state=? WHERE id=?', [state, runId]);
    try {
      const taskName = 'siteops-cmd-' + digest(full + '|' + (entry.container || '')).slice(0, 16);
      return await withLock('run:' + x.connectionId + ':' + x.applicationUuid + ':' + taskName, async () => {
        const tasks = safeList(await api.scheduledTasks(x.applicationUuid), 'Scheduled Tasks');
        let task = tasks.find(item => item.name === taskName);
        if (task && !taskMatches(task, full, entry.container))
          throw Object.assign(
            new Error(
              'Coolify-Task "' +
                taskName +
                '" weicht von der Vorgabe ab (Befehl, Container, Zeitplan, Timeout oder aktiviert). Keine Ausführung; Task in Coolify löschen, SiteOps legt sie neu an.'
            ),
            { statusCode: 409 }
          );
        if (!task) {
          // Disabled and yearly: it never fires on its own; SiteOps only triggers it explicitly.
          task = await api.createScheduledTask(x.applicationUuid, {
            name: taskName,
            command: full,
            frequency: TASK_FREQUENCY,
            timeout: TASK_TIMEOUT,
            enabled: false,
            ...(entry.container ? { container: entry.container } : {})
          });
        }
        const taskUuid = resourceId.parse(task?.uuid);
        let before = new Set();
        try {
          before = new Set(
            safeList(await api.scheduledTaskExecutions(x.applicationUuid, taskUuid), 'Ausführungen').map(e => e.uuid)
          );
        } catch {
          // A brand new task may have no execution list yet.
        }
        await api.executeScheduledTask(x.applicationUuid, taskUuid);
        for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
          await sleep(POLL_INTERVAL_MS);
          const executions = safeList(
            await api.scheduledTaskExecutions(x.applicationUuid, taskUuid),
            'Ausführungen'
          ).filter(e => !before.has(e.uuid));
          const latest = executions[0];
          if (latest && latest.status && latest.status !== 'running') {
            await finish(String(latest.status).slice(0, 40));
            return {
              runId,
              commandKey: x.commandKey,
              status: String(latest.status),
              finished: true,
              output: redact(latest.message).slice(0, MAX_MESSAGE)
            };
          }
        }
        await finish('running');
        return {
          runId,
          commandKey: x.commandKey,
          status: 'running',
          finished: false,
          output: 'Noch keine Rückmeldung von Coolify. Ergebnis unter Scheduled Tasks der Anwendung prüfen.'
        };
      });
    } catch (error) {
      await finish('error').catch(() => {});
      throw error;
    }
  }

  async function logs(raw) {
    const x = coolifyLogsSchema.parse(raw);
    const api = await getClient(x.connectionId);
    await ownedApplication(api, x.applicationUuid);
    const result = await api.applicationLogs(x.applicationUuid, {
      lines: String(x.lines),
      ...(x.serviceName ? { service_name: x.serviceName } : {})
    });
    return { logs: redact(result?.logs).slice(-MAX_LOG_CHARS), lines: x.lines };
  }

  async function restart(raw) {
    const x = coolifyRestartSchema.parse(raw);
    const api = await getClient(x.connectionId);
    await ownedApplication(api, x.applicationUuid);
    const result = await api.restartApplication(x.applicationUuid);
    return { uuid: x.applicationUuid, state: 'restart_requested', deploymentUuid: result?.deployment_uuid || null };
  }

  return { listCommands, defineCommand, deleteCommand, runCommand, logs, restart };
}
