/**
 * messageStore.js
 * In-memory buffer for LINE messages received during business hours.
 * Stores messages both globally (for hourly cron) and per LINE group (for keyword trigger).
 */

const store = [];
const groupStore = {};
const MAX_GROUP_MESSAGES = 200;

function addMessage(msg) {
  store.push(msg);
  console.log(`[Store] +1 message (total: ${store.length}) from "${msg.senderName}"`);
}

function flushMessages() {
  const snapshot = [...store];
  store.length = 0;
  console.log(`[Store] Flushed ${snapshot.length} message(s).`);
  return snapshot;
}

function peekMessages() { return [...store]; }

function addGroupMessage(groupId, msg) {
  if (!groupStore[groupId]) groupStore[groupId] = [];
  groupStore[groupId].push(msg);
  if (groupStore[groupId].length > MAX_GROUP_MESSAGES) groupStore[groupId].shift();
}

function flushGroupMessages(groupId) {
  const msgs = groupStore[groupId] ?? [];
  groupStore[groupId] = [];
  console.log(`[Store] Flushed ${msgs.length} message(s) from group ${groupId}.`);
  return msgs;
}

function peekGroupMessages(groupId) { return [...(groupStore[groupId] ?? [])]; }

module.exports = { addMessage, flushMessages, peekMessages, addGroupMessage, flushGroupMessages, peekGroupMessages };
