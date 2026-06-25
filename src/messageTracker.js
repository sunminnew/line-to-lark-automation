/**
 * messageTracker.js
 * In-memory per-group activity state for stale-chat alerts and off-hours buffering.
 */

// groupId -> { lastMsgTime, lastSenderName, lastText, alertLevel }
const groupActivity = new Map();

// groupId -> [{ timestamp, senderName, text }]
const offHoursStore = new Map();

/** Record a new message — resets alert level for that group. */
function recordActivity(groupId, senderName, text) {
  groupActivity.set(groupId, {
    lastMsgTime:    Date.now(),
    lastSenderName: senderName,
    lastText:       text,
    alertLevel:     null, // null | 'yellow' | 'red'
  });
}

/** Return groups whose last message is older than thresholdMs. */
function getStaleGroups(thresholdMs) {
  const now = Date.now();
  const result = [];
  for (const [groupId, info] of groupActivity.entries()) {
    if (now - info.lastMsgTime >= thresholdMs) {
      result.push({ groupId, ageMs: now - info.lastMsgTime, ...info });
    }
  }
  return result;
}

function setAlertLevel(groupId, level) {
  const info = groupActivity.get(groupId);
  if (info) info.alertLevel = level;
}

function getAlertLevel(groupId) {
  return groupActivity.get(groupId)?.alertLevel ?? null;
}

/** Buffer an off-hours message for morning delivery. */
function addOffHoursMessage(groupId, msg) {
  if (!offHoursStore.has(groupId)) offHoursStore.set(groupId, []);
  offHoursStore.get(groupId).push(msg);
}

/** Return and clear off-hours messages for a group. */
function flushOffHoursMessages(groupId) {
  const msgs = offHoursStore.get(groupId) ?? [];
  offHoursStore.delete(groupId);
  return msgs;
}

/** All groups that have pending off-hours messages. */
function getAllGroupsWithOffHours() {
  return [...offHoursStore.keys()];
}

module.exports = {
  recordActivity,
  getStaleGroups,
  setAlertLevel,
  getAlertLevel,
  addOffHoursMessage,
  flushOffHoursMessages,
  getAllGroupsWithOffHours,
};
