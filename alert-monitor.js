/**
 * alert-monitor.js (Updated Version)
 * ----------------
 * Monitors the real-time Pikud Ha'Oref feed (Alerts.json).
 * Includes best practices: Concurrent requests, pre-save history, 
 * flexible city matching, and timestamped logging.
 *
 * Requires: npm i axios dotenv
 */

require("dotenv").config();
const axios = require("axios");
const fs = require("fs").promises;
const { existsSync } = require("fs");
const path = require("path");
const config = require('./config.json');

// --- CONFIGURATION ---
const FETCH_URL = "https://www.oref.org.il/WarningMessages/alert/Alerts.json";
const HIST_FILE = path.join(__dirname, "Historical_realtime.json");
// Prefer .env, fallback to config.json
const WEBHOOK_URL = process.env.WEBHOOK_URL || config.webhookTarget.url; 

// --- LOGGING HELPERS ---
function getTimestamp() {
  return `[${new Date().toLocaleString('he-IL', { 
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  })}]`;
}

const log = (message, ...args) => console.log(getTimestamp(), message, ...args);
const warn = (message, ...args) => console.warn(getTimestamp(), message, ...args);
const error = (message, ...args) => console.error(getTimestamp(), message, ...args);

// --- HISTORY HELPERS ---
async function loadHistory() {
  if (!existsSync(HIST_FILE)) await fs.writeFile(HIST_FILE, "[]", "utf8");
  try {
      return JSON.parse(await fs.readFile(HIST_FILE, "utf8"));
  } catch (e) {
      error("⚠️ Corrupted history file, resetting.");
      await fs.writeFile(HIST_FILE, "[]", "utf8");
      return [];
  }
}

async function saveHistory(history) {
  await fs.writeFile(HIST_FILE, JSON.stringify(history, null, 2), "utf8");
}

/**
 * Returns a Promise for sending a generic webhook.
 * We return the Promise here so we can use Promise.allSettled later.
 */
function sendWebhook(alertKey, city, messageContent) {
  const payload = {
    alertKey: alertKey,
    city: city,
    content: messageContent,
  };
  const headers = { "Content-Type": "application/json" };
  return axios.post(WEBHOOK_URL, payload, { headers, timeout: 5000 });
}

// --- ADVANCED FEED CLASS ---
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
        log("[+] Cookies fetched successfully.");
      }
    } catch (e) {
      warn("[-] Cookie refresh failed:", e.message);
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
        log("[-] Auth error (401/403). Refreshing cookies...");
        await this.refreshCookies();
        return this.fetch();
    }

    if (r.headers["last-modified"]) this.ifMod = r.headers["last-modified"];
    if (r.headers.etag) this.ifNone = r.headers.etag;

    return r.status === 200 ? r.data : null;
  }
}

// --- MAIN LOOP ---
(async () => {
  if (!WEBHOOK_URL || !WEBHOOK_URL.startsWith('http')) {
    error("Error: Please specify a valid webhook URL in config.json or .env.");
    return;
  }
  if (!config.citiesToMonitor || !Array.isArray(config.citiesToMonitor) || config.citiesToMonitor.length === 0) {
    error("Error: `citiesToMonitor` in config.json must be a non-empty array.");
    return;
  }

  const feed = new Feed();
  let history = await loadHistory();
  await feed.refreshCookies();

  log(`Starting alert monitor for cities: "${config.citiesToMonitor.join(', ')}"`);
  log(`Webhooks will be sent to: ${WEBHOOK_URL}`);

  setInterval(async () => {
    try {
      const alert = await feed.fetch();
      
      if (!alert || !alert.data || alert.data.length === 0) {
        return; 
      }
      
      log(`[!] Alert received: ${alert.title} in [${alert.data.join(", ")}]`);

      const mapping = config.alertMappings.find(m => m.key === alert.title);
      if (!mapping) {
        log(`[-] Alert title "${alert.title}" not found in alertMappings. Skipping.`);
        return;
      }

      // [IMPROVEMENT 1 & 3]: Flexible match + National alerts
      const matchingCities = alert.data.filter(alertCity => {
        if (alertCity === "ברחבי הארץ") return true;
        return config.citiesToMonitor.some(monitoredCity => 
          alertCity.includes(monitoredCity) || monitoredCity.includes(alertCity)
        );
      });

      if (matchingCities.length === 0) {
        return; 
      }

      // [TODO: Will be updated in the next step to include city deduplication]
      const now = Date.now();
      if (history.some(h => h.alertTitle === alert.title && now - new Date(h.date).getTime() <= config.monitoringIntervals.duplicateWindow_ms)) {
        log(`[-] Duplicate alert detected for "${alert.title}". Skipping.`);
        return;
      }

      log(`[+] Found match for cities: ${matchingCities.join(", ")}`);

      // [IMPROVEMENT 2]: Update history BEFORE sending webhooks
      history.push({ alertTitle: alert.title, date: new Date().toISOString() });
      await saveHistory(history);

      // [IMPROVEMENT 4]: Concurrent requests using Promise.allSettled
      const webhookPromises = matchingCities.map(city => sendWebhook(alert.title, city, mapping.message));
      
      const results = await Promise.allSettled(webhookPromises);
      
      results.forEach((r, i) => {
        const city = matchingCities[i];
        if (r.status === "rejected") {
          error(`❌ Webhook POST failed for ${city}:`, r.reason?.message);
        } else {
          log(`✅ Webhook sent successfully for "${alert.title}" in ${city}.`);
        }
      });

    } catch (err) {
      error("[-] Error during fetch cycle:", err.message);
    }
  }, config.monitoringIntervals.fetch_ms);
})();
