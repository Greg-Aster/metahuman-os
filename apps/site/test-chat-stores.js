// Test script to show store usage issues
const testCode = `
// These are stores (from useMessages):
const { messages, selectedMessage } = messagesApi;

// WRONG - treating store as regular variable:
if (messages.length === 0) { } // ❌ Store object doesn't have .length

// RIGHT - use $ prefix in template or get() in script:
if ($messages.length === 0) { } // ✅ In template
if (get(messages).length === 0) { } // ✅ In script

// WRONG - can't assign to store directly:
messages = [...messages, newMsg]; // ❌ Can't reassign const

// RIGHT - use store methods:
messages.update(msgs => [...msgs, newMsg]); // ✅
`;

console.log(testCode);
