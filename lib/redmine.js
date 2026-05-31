import { execSync } from "node:child_process";

let lwrAvailable = null;

function hasLwr() {
  if (lwrAvailable !== null) return lwrAvailable;
  try {
    execSync("which lwr", { stdio: "ignore" });
    lwrAvailable = true;
  } catch {
    lwrAvailable = false;
  }
  return lwrAvailable;
}

function getIssue(issueId) {
  if (!hasLwr()) return null;
  try {
    const raw = execSync(`lwr issue view ${issueId} --json`, {
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const data = JSON.parse(raw);
    if (!data.ok) return null;
    return {
      id: data.data.id,
      subject: data.data.subject,
      status: data.data.status?.name,
      priority: data.data.priority?.name,
      assignee: data.data.assigned_to?.name,
      tracker: data.data.tracker?.name,
      project: data.data.project?.name,
    };
  } catch {
    return null;
  }
}

function extractIssueId(text, pattern) {
  if (!text) return null;
  const match = text.match(new RegExp(`${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)`));
  return match ? match[1] : null;
}

export { hasLwr, getIssue, extractIssueId };
