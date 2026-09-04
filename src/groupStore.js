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

function addGroup(id) {
  if (!id) return;
  if (!known.has(id)) {
    known.add(id);
    console.log('[GroupStore] New group registered:', id.slice(0, 12) + '...');
  }
}

function getAllGroups() {
  return [...known];
}

module.exports = { addGroup, getAllGroups };
