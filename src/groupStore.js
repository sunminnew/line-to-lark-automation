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

// Groups that must NOT get translation or scheduled greetings.
// Set HR_GROUP_ID env var to exclude a specific group (e.g. a check-in
// alert-only group that should never be translated).
// If HR_GROUP_ID is not set, no group is excluded.
function isExcludedGroup(id) {
    if (!id) return false;
    const hr = (process.env.HR_GROUP_ID || '').trim();
    if (!hr) return false;
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
