/**
 * larkIntegration.js
 * Authenticates with Lark (Feishu) and creates tasks via the Task v1 API.
 *
 * Lark Docs:
 *   Auth (tenant_access_token) → https://open.larksuite.com/document/uAjLw4CM/ukTMukTMukTM/authentication-management/access-token/get-tenant-access-token-internally
 *   Create Task               → https://open.larksuite.com/document/uAjLw4CM/ukTMukTMukTM/task-v1/task/create
 *
 * NOTE: Lark uses epoch seconds (not ms) for due dates.
 */

const axios = require('axios');

const LARK_BASE      = 'https://open.larksuite.com/open-apis';
const APP_ID         = process.env.LARK_APP_ID;
const APP_SECRET     = process.env.LARK_APP_SECRET;
const ASSIGNEE_ID    = process.env.LARK_ASSIGNEE_USER_ID; // open_id or user_id

// ── Token cache ───────────────────────────────────────────────────────────────
// tenant_access_token expires in 2 hours; cache it to avoid hammering auth.
let tokenCache = { token: null, expiresAt: 0 };

/**
 * Returns a valid tenant_access_token, refreshing if expired.
 * @returns {Promise<string>}
 */
async function getTenantToken() {
  const now = Date.now();
  if (tokenCache.token && now < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  const res = await axios.post(`${LARK_BASE}/auth/v3/tenant_access_token/internal`, {
    app_id:     APP_ID,
    app_secret: APP_SECRET,
  });

  if (res.data.code !== 0) {
    throw new Error(`[Lark Auth] Failed: ${JSON.stringify(res.data)}`);
  }

  tokenCache = {
    token:     res.data.tenant_access_token,
    expiresAt: now + (res.data.expire - 60) * 1000, // refresh 60 s early
  };

  console.log('[Lark] Access token refreshed.');
  return tokenCache.token;
}

// ── Priority mapping ──────────────────────────────────────────────────────────
// Lark Task API does not have a native priority field in v1;
// we prepend it to the description and optionally encode in the summary tag.
const PRIORITY_EMOJI = { High: '🔴', Medium: '🟡', Low: '🟢' };

// ── Create Task ───────────────────────────────────────────────────────────────

/**
 * Creates a single task in Lark.
 * @param {{ summary, description, priority, client_name }} task
 * @returns {Promise<string>} Created task ID
 */
async function createLarkTask(task) {
  const token = await getTenantToken();

  const priorityTag = PRIORITY_EMOJI[task.priority] ?? '⚪';
  const richDescription =
    `[${task.priority} Priority] [Client: ${task.client_name}]\n\n${task.description}`;

  // Due date = end of today (23:59:59) in Unix seconds
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 0);
  const dueEpochSec = Math.floor(endOfToday.getTime() / 1000).toString();

  const payload = {
    summary: `${priorityTag} ${task.summary}`.slice(0, 100),
    description: richDescription,
    due: {
      time: dueEpochSec,
    },
    // Optionally add a collaborator / assignee
    ...(ASSIGNEE_ID
      ? {
          collaborator_ids: [ASSIGNEE_ID],
        }
      : {}),
    // origin links back to LINE (no URL available, so we use a label)
    origin: {
      platform_i18n_name: {
        en_us: 'LINE Chat',
        zh_cn: 'LINE聊天',
      },
    },
  };

  try {
    const res = await axios.post(`${LARK_BASE}/task/v1/tasks`, payload, {
      headers: {
        'Content-Type':  'application/json',
        Authorization:   `Bearer ${token}`,
      },
    });

    if (res.data.code !== 0) {
      throw new Error(JSON.stringify(res.data));
    }

    const taskId = res.data.data.task.id;
    console.log(`[Lark] Task created: "${task.summary}" (id: ${taskId})`);
    return taskId;
  } catch (err) {
    console.error('[Lark] Create task failed:', err.response?.data ?? err.message);
    throw err;
  }
}

/**
 * Loops through an array of AI-generated tasks and creates each in Lark.
 * Failures on individual tasks are logged but do not abort the loop.
 * @param {Array} tasks
 * @returns {Promise<Array<string>>} List of created task IDs
 */
async function createTasksInLark(tasks) {
  const created = [];
  for (const task of tasks) {
    try {
      const id = await createLarkTask(task);
      created.push(id);
    } catch {
      // already logged inside createLarkTask
    }
  }
  return created;
}

module.exports = { createTasksInLark };
