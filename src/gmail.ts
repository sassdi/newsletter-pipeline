import { google } from "googleapis";
import type { gmail_v1 } from "googleapis";
import type { RawEmail } from "./types.js";

// Filters by Gmail label rather than sender address -- sender addresses
// drift over time (newsletter platforms change their sending domain), a
// label is stable and lets the user route any AI newsletter into scope
// just by tagging it.
const QUERY = "label:ai-news is:unread";
const MAX_PER_RUN = 5;
// Cap on how many unread candidates we scan (metadata-only) to find the
// oldest MAX_PER_RUN. Gmail's list() is always newest-first for a given
// query, so getting "oldest unread" requires listing a larger candidate
// pool, sorting by internalDate ourselves, then only fetching full bodies
// for the 5 we'll actually process (see NOTE below).
const CANDIDATE_SCAN_LIMIT = 200;

function getAuthClient() {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URL
  );
  client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return client;
}

function getGmailClient(): gmail_v1.Gmail {
  return google.gmail({ version: "v1", auth: getAuthClient() });
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf-8");
}

function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";

  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (payload.parts) {
    const plainPart = payload.parts.find((p) => p.mimeType === "text/plain");
    if (plainPart?.body?.data) return decodeBase64Url(plainPart.body.data);

    const htmlPart = payload.parts.find((p) => p.mimeType === "text/html");
    if (htmlPart?.body?.data) return decodeBase64Url(htmlPart.body.data);

    for (const part of payload.parts) {
      const nested = extractBody(part);
      if (nested) return nested;
    }
  }

  return "";
}

function getHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

/**
 * Fetches up to MAX_PER_RUN unread candidate emails, oldest first, so a
 * backlog drains over successive runs instead of only ever re-scanning the
 * newest unread mail. NOTE: this is a two-phase fetch (metadata scan, then
 * full body fetch of just the winners) rather than passing maxResults=5
 * straight to list() -- Gmail's list() is newest-first, so a maxResults=5
 * list() call would only ever return the 5 newest unread messages and
 * sorting those afterward wouldn't achieve backlog-draining.
 */
export async function fetchUnreadNewsletters(): Promise<RawEmail[]> {
  const gmail = getGmailClient();

  const listRes = await gmail.users.messages.list({
    userId: "me",
    q: QUERY,
    maxResults: CANDIDATE_SCAN_LIMIT,
  });

  const candidateIds = (listRes.data.messages ?? []).map((m) => m.id!).filter(Boolean);
  if (candidateIds.length === 0) return [];

  const withDates = await Promise.all(
    candidateIds.map(async (id) => {
      const res = await gmail.users.messages.get({
        userId: "me",
        id,
        format: "metadata",
        metadataHeaders: ["Subject", "From"],
      });
      return { id, internalDate: Number(res.data.internalDate ?? 0) };
    })
  );

  const oldestFirst = withDates.sort((a, b) => a.internalDate - b.internalDate).slice(0, MAX_PER_RUN);

  const fullMessages = await Promise.all(
    oldestFirst.map(({ id }) => gmail.users.messages.get({ userId: "me", id, format: "full" }))
  );

  return fullMessages.map((res) => {
    const headers = res.data.payload?.headers;
    return {
      id: res.data.id!,
      subject: getHeader(headers, "Subject"),
      from: getHeader(headers, "From"),
      body: extractBody(res.data.payload),
      internalDate: Number(res.data.internalDate ?? 0),
    };
  });
}

export async function markAsRead(messageId: string): Promise<void> {
  const gmail = getGmailClient();
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: { removeLabelIds: ["UNREAD"] },
  });
}
