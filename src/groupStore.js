/**
 * groupStore.js
 * In-memory registry of all LINE group IDs the bot has seen.
 * Seeds from KNOWN_GROUP_IDS env var at startup.
 * Auto-grows as new groups send messages via webhook.
 */

const known = new Set(
  (process.env.KNOWN_GROUP_IDS || '')
    .split(',').map(s => s.trim()).filter(Boolean)
);

// Groups that must NOT get translation or scheduled greetings
// (the HR check-in alert group). Defaults to the HR - zinith9 group.
function isExcludedGroup(id) {
  if (!id) return false;
  const hr = (process.env.HR_GROUP_ID || 'Ce6c789004bf543455234dd166cae5d95').trim();
  return id === hr;
}

function addGroup(id) {
  if (!id || isExcludedGroup(id)) return;
  if (!known.has(id)) {
    known.add(id);
    console.log('[GroupStore] New group registered:', id.slice(0, 12) + '...');
  }
}

function getAllGroups() {
  return [...known].filter(id => !isExcludedGroup(id));
}

module.exports = { addGroup, getAllGroups, isExcludedGroup };
