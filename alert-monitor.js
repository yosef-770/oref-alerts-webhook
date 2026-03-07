/**
 * alert-monitor.js
 * ----------------
 * Monitors Pikud Ha'Oref real-time feed.
 * Features: Smart deduplication, dynamic fallback to 'desc',
 * concurrent webhooks, 24h history retention, and fully customizable webhook templates.
 */

require("dotenv").config();
const axios = require("axios");
const fs = require("fs").promises;
const { existsSync } = require("fs");
const path = require("path");
const config = require('./config.json');

const FETCH_URL = "https://www.oref.org.il/WarningMessages/alert/Alerts.json";
const HIST_FILE = path.join(__dirname, "Historical_realtime.json");
const WEBHOOK_URL = process.env.WEBHOOK_URL || config.webhookTarget.url; 
const HISTORY_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours

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

// --- TEMPLATE INTERPOLATION ENGINE ---
/**
 * Recursively traverses an object/array and replaces placeholders like ${key}
 * with actual values from the 'vars' object or from process.env.
 */
function interpolateObject(obj, vars) {
  if (typeof obj === 'string') {
    return obj.replace(/\${(.*?)}/g, (match, key) => {
      if (vars[key] !== undefined) return vars[key];
      if (process.env[key] !== undefined) return process.env[key];
      return match; // Leave as is if no replacement found
    });
  } else if (Array.isArray(obj)) {
    return obj.map(item => interpolateObject(item, vars));
  } else if (obj !== null && typeof obj === 'object') {
    const newObj = {};
    for (const [k, v] of Object.entries(obj)) {
      newObj[k] = interpolateObject(v, vars);
    }
    return newObj;
  }
  return obj;
}

function sendWebhook(alertKey, city, messageContent) {
  const template = config.webhookTarget.template;
  
  // Define the dynamic variables available for injection
  const dynamicVars = {
    alertKey: alertKey,
    city: city,
    content: messageContent,
    timestamp: new Date().toISOString()
  };

  // If the user defined a template in config.json, use it. Otherwise, fallback to the old default structure.
  if (template) {
    const method = template.method || "POST";
    const headers = interpolateObject(template.headers || {}, dynamicVars);
    const data = interpolateObject(template.body || {}, dynamicVars);

    return axios({
      method: method,
      url: WEBHOOK_URL,
      headers: headers,
      data: data,
      timeout: 5000
    });
  } else {
    // Fallback if no template is found in config
    const payload = { alertKey, city, content: messageContent };
    return axios.post(WEBHOOK_URL, payload, { headers: { "Content-Type": "application/json" }, timeout: 5000 });
  }
}

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

      const matchingCities = alert.data.filter(alertCity => {
        if (alertCity === "ברחבי הארץ") return true;
        return config.citiesToMonitor.some(monitoredCity => 
          alertCity.includes(monitoredCity) || monitoredCity.includes(alertCity)
        );
      });

      if (matchingCities.length === 0) return; 

      const now = Date.now();
      const dupWindow = config.monitoringIntervals.duplicateWindow_ms;

      history = history.filter(h => now - new Date(h.date).getTime() <= HISTORY_RETENTION_MS);

      const citiesToAlert = matchingCities.filter(city => {
        const alreadyAlerted = history.some(h => 
          h.alertTitle === alert.title && 
          h.cities.includes(city) &&
          (now - new Date(h.date).getTime() <= dupWindow) 
        );
        return !alreadyAlerted;
      });

      if (citiesToAlert.length === 0) {
        log(`[-] Duplicate alert detected for all matching cities for "${alert.title}". Skipping.`);
        return;
      }

      log(`[+] Found new match for cities: ${citiesToAlert.join(", ")}`);

      const mapping = config.alertMappings.find(m => m.key === alert.title);
      const messageContent = mapping ? mapping.message : (alert.desc || "התקבלה התרעה, יש לפעול על פי הנחיות פיקוד העורף.");

      history.push({ 
        alertTitle: alert.title, 
        cities: citiesToAlert, 
        date: new Date().toISOString() 
      });
      await saveHistory(history);

      const webhookPromises = citiesToAlert.map(city => sendWebhook(alert.title, city, messageContent));
      const results = await Promise.allSettled(webhookPromises);
      
      results.forEach((r, i) => {
        const city = citiesToAlert[i];
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
