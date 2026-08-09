import "dotenv/config";
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { google } from "googleapis";

// One-time setup script: mints a Gmail OAuth2 refresh token and writes it
// into .env. Not part of the pipeline runtime -- run manually via
// `npm run gmail:auth` after GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET are set.

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URL = process.env.GOOGLE_REDIRECT_URL ?? "http://localhost:3000/auth/callback";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env before running this script.");
  process.exit(1);
}

const redirect = new URL(REDIRECT_URL);
const port = Number(redirect.port) || 80;

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URL);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent", // forces a refresh_token even if this account authorized before
  scope: ["https://www.googleapis.com/auth/gmail.modify"],
});

function saveRefreshToken(token: string) {
  const envPath = new URL("../.env", import.meta.url);
  const contents = readFileSync(envPath, "utf-8");
  const updated = contents.includes("GOOGLE_REFRESH_TOKEN=")
    ? contents.replace(/GOOGLE_REFRESH_TOKEN=.*/g, `GOOGLE_REFRESH_TOKEN=${token}`)
    : `${contents}\nGOOGLE_REFRESH_TOKEN=${token}\n`;
  writeFileSync(envPath, updated);
}

const server = createServer(async (req, res) => {
  if (!req.url || !req.url.startsWith(redirect.pathname)) {
    res.writeHead(404);
    res.end();
    return;
  }

  const url = new URL(req.url, REDIRECT_URL);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end(`Authorization failed: ${error}`);
    console.error(`Authorization failed: ${error}`);
    server.close();
    process.exit(1);
  }

  if (!code) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Missing authorization code.");
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.refresh_token) {
      throw new Error(
        "No refresh_token returned. This usually means the account already granted consent " +
          "previously without one being issued -- revoke access at " +
          "https://myaccount.google.com/permissions and try again."
      );
    }

    saveRefreshToken(tokens.refresh_token);

    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Authorization complete. You can close this tab and return to the terminal.");
    console.log("\nSuccess. GOOGLE_REFRESH_TOKEN written to .env.");
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Token exchange failed. Check the terminal for details.");
    console.error("Token exchange failed:", err);
  } finally {
    server.close();
  }
});

server.listen(port, () => {
  console.log("Open this URL in your browser to authorize Gmail access:\n");
  console.log(authUrl);
  console.log(`\nWaiting for the redirect on ${REDIRECT_URL} ...`);
});
