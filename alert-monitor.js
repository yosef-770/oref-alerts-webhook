/**
 * alert-monitor.js (Based on red-alert-notifier.js)
 * ----------------
 * Monitors the real-time Pikud Ha'Oref feed (Alerts.json).
 * When an alert occurs, it checks against a list of cities from config.json.
 * If a match is found, it sends a generic, structured webhook.
 * Manages cookies and caching headers for efficient polling.
 *
 * Requires: npm i axios
 */

const axios = require("axios");
const fs = require("fs").promises;
const { existsSync } = require("fs");
const path = require("path");

// --- CONFIGURATION ---
// All settings are now loaded from the external config file.
const config = require('./config.json');
const FETCH_URL = "https://www.oref.org.il/WarningMessages/alert/Alerts.json";
const HIST_FILE = path.join(__dirname, "Historical_realtime.json");

// --- HELPER FUNCTIONS ---

async function loadHistory() {
  if (!existsSync(HIST_FILE)) await fs.writeFile(HIST_FILE, "[]", "utf8");
  try {
      return JSON.parse(await fs.readFile(HIST_FILE, "utf8"));
  } catch (e) {
      console.error("⚠️ Corrupted history file, resetting.");
      await fs.writeFile(HIST_FILE, "[]", "utf8");
      return [];
  }
}

async function saveHistory(history) {
  await fs.writeFile(HIST_FILE, JSON.stringify(history, null, 2), "utf8");
}

/**
 * Sends a generic webhook to the configured target URL.
 * @param {string} alertKey - The original alert title.
 * @param {string} city - The city/area for the alert.
 * @param {string} messageContent - The custom message from the mapping.
 */
async function sendWebhook(alertKey, city, messageContent) {
  const payload = {
    alertKey: alertKey,
    city: city,
    content: messageContent,
  };
  const headers = { "Content-Type": "application/json" };
  try {
    await axios.post(config.webhookTarget.url, payload, { headers, timeout: 5000 });
    console.log(`✅ Webhook sent successfully for "${alertKey}" in ${city}.`);
  } catch (err) {
    console.error(`❌ Webhook POST failed for ${city}:`, err.message);
  }
}

// --- ADVANCED FEED CLASS (Handles Cookies & Caching) ---
class Feed {
  constructor() {
    this.headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36",
      "Referer": "https://www.oref.org.il/",
      "X-Requested-With": "XMLHttpRequest"
    };
    this.cookies = null;
    this.ifMod = null;
    this.ifNone = null;
  }

  async refreshCookies() {
    try {
      const r = await axios.get("https://www.oref.org.il/", { headers: this.headers });
      if (r.status === 200 && r.headers["set-cookie"]) {
        this.cookies = r.headers["set-cookie"].join("; ");
        console.log("[+] Cookies fetched successfully.");
      }
    } catch (e) {
      console.warn("[-] Cookie refresh failed:", e.message);
      this.cookies = null;
    }
  }

  async fetch() {
    const h = { ...this.headers };
    if (this.ifMod) h["If-Modified-Since"] = this.ifMod;
    if (this.ifNone) h["If-None-Match"] = this.ifNone;
    if (this.cookies) h.Cookie = this.cookies;

    const r = await axios.get(FETCH_URL, { headers: h, validateStatus: s => s < 500 });
    
    if ([401, 403].includes(r.status)) {
        console.log("[-] Auth error (401/403). Refreshing cookies...");
        await this.refreshCookies();
        return this.fetch();
    }

    if (r.headers["last-modified"]) this.ifMod = r.headers["last-modified"];
    if (r.headers.etag) this.ifNone = r.headers.etag;

    // Return data on 200 OK, otherwise null (e.g., for 304 Not Modified)
    return r.status === 200 ? r.data : null;
  }
}

// --- MAIN LOOP ---
(async () => {
  // Validate configuration on startup
  if (!config.webhookTarget.url || !config.webhookTarget.url.startsWith('http')) {
    console.error("Error: Please specify a valid webhook URL in config.json.");
    return;
  }
  if (!config.citiesToMonitor || !Array.isArray(config.citiesToMonitor) || config.citiesToMonitor.length === 0) {
    console.error("Error: `citiesToMonitor` in config.json must be a non-empty array.");
    return;
  }

  const feed = new Feed();
  let history = await loadHistory();
  await feed.refreshCookies();

  console.log(`Starting alert monitor for cities: "${config.citiesToMonitor.join(', ')}"`);
  console.log(`Webhooks will be sent to: ${config.webhookTarget.url}`);

  setInterval(async () => {
    try {
      const alert = await feed.fetch();
      // If no alert (or 304 Not Modified), do nothing.
      if (!alert || !alert.data || alert.data.length === 0) {
        return;
      }
      
      console.log(`[!] Alert received: ${alert.title} in [${alert.data.join(", ")}]`);

      // Find the corresponding message from our config
      const mapping = config.alertMappings.find(m => m.key === alert.title);
      if (!mapping) {
        console.log(`[-] Alert title "${alert.title}" not found in alertMappings. Skipping.`);
        return;
      }

      // Check which of the alert's cities match our monitoring list
      const matchingCities = alert.data.filter(alertCity => config.citiesToMonitor.includes(alertCity));
      if (matchingCities.length === 0) {
        return; // This alert is not for us
      }

      // Check for duplicates
      const now = Date.now();
      if (history.some(h => h.alertTitle === alert.title && now - new Date(h.date).getTime() <= config.monitoringIntervals.duplicateWindow_ms)) {
        console.log(`[-] Duplicate alert detected for "${alert.title}". Skipping.`);
        return;
      }

      console.log(`[+] Found match for cities: ${matchingCities.join(", ")}`);

      // Send a webhook for each matching city
      for (const city of matchingCities) {
        await sendWebhook(alert.title, city, mapping.message);
      }
      
      // Save to history to prevent duplicates
      history.push({ alertTitle: alert.title, date: new Date().toISOString() });
      await saveHistory(history);

    } catch (error) {
      console.error("[-] Error during fetch cycle:", error.message);
    }
  }, config.monitoringIntervals.fetch_ms);
})();