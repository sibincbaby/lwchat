import { requireAuth } from "./auth.js";

const BASE = "https://chat.googleapis.com/v1";

async function api(path, opts = {}) {
  const token = await requireAuth();
  const url = new URL(`${BASE}/${path}`);

  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
    }
  }

  const fetchOpts = {
    method: opts.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };

  if (opts.body) fetchOpts.body = JSON.stringify(opts.body);

  const res = await fetch(url, fetchOpts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      `Chat API ${res.status}: ${err.error?.message || res.statusText}`
    );
  }
  return res.json();
}

async function listSpaces(pageSize = 100, pageToken) {
  return api("spaces", {
    params: { pageSize, pageToken, filter: 'spaceType = "SPACE"' },
  });
}

async function listAllSpaces() {
  const spaces = [];
  let pageToken;
  do {
    const result = await listSpaces(100, pageToken);
    spaces.push(...(result.spaces || []));
    pageToken = result.nextPageToken;
  } while (pageToken);
  return spaces;
}

async function getMe() {
  const token = await requireAuth();
  const url = "https://people.googleapis.com/v1/people/me?personFields=names,emailAddresses";
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const data = await res.json();
  return {
    name: data.names?.[0]?.displayName || null,
    email: data.emailAddresses?.[0]?.value || null,
    userId: data.resourceName?.replace("people/", "users/") || null,
  };
}

async function listMessages(spaceId, { pageSize = 100, orderBy = "createTime desc", pageToken, filter } = {}) {
  return api(`${spaceId}/messages`, {
    params: { pageSize, orderBy, pageToken, filter },
  });
}

async function listThreadMessages(spaceId, threadName, pageSize = 100) {
  return api(`${spaceId}/messages`, {
    params: {
      pageSize,
      filter: `thread.name = "${threadName}"`,
    },
  });
}

async function sendMessage(spaceId, threadName, text) {
  return api(`${spaceId}/messages`, {
    method: "POST",
    params: {
      messageReplyOption: "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD",
    },
    body: {
      text,
      thread: { name: threadName },
    },
  });
}

// Top-level message (creates a new thread). No thread.name in body.
async function postToSpace(spaceId, text) {
  return api(`${spaceId}/messages`, {
    method: "POST",
    body: { text },
  });
}

// Existing 1:1 DM space with the given user, or null if none exists.
// Creating a brand-new DM requires the chat.memberships write scope which
// lwchat doesn't request — surface that to the caller as a null return.
async function findDirectMessage(userId) {
  try {
    return await api(`spaces:findDirectMessage`, { params: { name: userId } });
  } catch (e) {
    if (/404/.test(e.message)) return null;
    throw e;
  }
}

async function* paginateMessages(spaceId, { pageSize = 100, orderBy = "createTime desc", maxPages = 20 } = {}) {
  let pageToken;
  let pages = 0;

  while (pages < maxPages) {
    const result = await listMessages(spaceId, { pageSize, orderBy, pageToken });
    const messages = result.messages || [];
    if (messages.length === 0) break;

    yield messages;

    pageToken = result.nextPageToken;
    if (!pageToken) break;
    pages++;
  }
}

async function listMembers(spaceId, pageSize = 200, pageToken) {
  return api(`${spaceId}/members`, {
    params: { pageSize, pageToken, filter: 'member.type = "HUMAN"' },
  });
}

async function buildMemberMap(spaceId) {
  const map = new Map();
  for await (const messages of paginateMessages(spaceId, { maxPages: 10, pageSize: 100 })) {
    for (const m of messages) {
      if (!m.annotations) continue;
      const text = m.argumentText || m.text || "";
      for (const ann of m.annotations) {
        if (ann.type !== "USER_MENTION") continue;
        const userId = ann.userMention?.user?.name;
        if (!userId || map.has(userId)) continue;
        const name = text.slice(ann.startIndex, ann.startIndex + ann.length).replace(/^@/, "");
        if (name) map.set(userId, name);
      }
    }
  }
  return map;
}

function resolveMentions(text, memberMap) {
  const fullNameToId = new Map();
  const firstNameToId = new Map();

  for (const [id, name] of memberMap) {
    fullNameToId.set(name.toLowerCase(), id);
    const firstName = name.toLowerCase().split(/\s+/)[0];
    if (!firstNameToId.has(firstName)) {
      firstNameToId.set(firstName, id);
    } else {
      firstNameToId.set(firstName, null);
    }
  }

  return text.replace(/@([A-Za-z]+(?:\s+[A-Za-z]+)?(?:\s+[A-Za-z]+)?)/g, (match, rawName) => {
    if (rawName.toLowerCase() === "all") return "<users/all>";
    const words = rawName.split(/\s+/);

    // Try full 3-word match, then 2-word, then 1-word
    for (let len = Math.min(words.length, 3); len >= 1; len--) {
      const candidate = words.slice(0, len).join(" ").toLowerCase();
      if (fullNameToId.has(candidate)) {
        const remainder = words.slice(len).join(" ");
        return `<${fullNameToId.get(candidate)}>${remainder ? " " + remainder : ""}`;
      }
    }

    // Try first-name only (if unambiguous)
    const first = words[0].toLowerCase();
    const id = firstNameToId.get(first);
    if (id) {
      const remainder = words.slice(1).join(" ");
      return `<${id}>${remainder ? " " + remainder : ""}`;
    }

    return match;
  });
}

export {
  listSpaces,
  listAllSpaces,
  getMe,
  listMessages,
  listThreadMessages,
  sendMessage,
  postToSpace,
  findDirectMessage,
  paginateMessages,
  listMembers,
  buildMemberMap,
  resolveMentions,
};
