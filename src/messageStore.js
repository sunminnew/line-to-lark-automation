/**
 * messageStore.js
 * In-memory buffer for LINE messages received during business hours.
 * Each entry: { timestamp: ISO string, senderName: string, text: string }
 *
 * For production with multiple workers, swap this for Redis:
 *   LPUSH  line:messages  JSON.stringify(entry)
 *   LRANGE line:messages  0 -1  (fetch)
 *   DEL    line:messages        (clear)
 */

const store = [];

/**
 * Append a message to the buffer.
 * @param {{ timestamp: string, senderName: string, text: string }} msg
 */
function addMessage(msg) {
  store.push(msg);
  console.log(`[Store] +1 message (total: ${store.length}) from "${msg.senderName}"`);
}

/**
 * Return a shallow copy of all buffered messages then clear the buffer.
 * @returns {Array}
 */
function flushMessages() {
  const snapshot = [...store];
  store.length = 0;
  console.log(`[Store] Flushed ${snapshot.length} message(s).`);
  return snapshot;
}

/**
 * Peek without clearing (useful for debugging).
 * @returns {Array}
 */
function peekMessages() {
  return [...store];
}

module.exports = { addMessage, flushMessages, peekMessages };
