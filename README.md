
# 🚀 Pikud Ha'Oref (Home Front Command) Alert Webhook

An advanced, highly customizable Node.js script that monitors Israel's Home Front Command (Pikud Ha'Oref) alerts in real-time and sends structured webhooks to any external server or service.

This tool is designed for reliability and flexibility. It allows you to monitor specific cities, fully customize the outgoing HTTP requests (headers, body, methods), and automatically react to alerts in your own systems (e.g., send messages to Telegram/Discord/WhatsApp, activate PA systems, update a website status, and more).

---

## ✨ Key Features

* **📍 Smart City Monitoring**: Define a list of cities/regions. The script uses flexible matching to catch alerts even if Pikud Ha'Oref slightly changes the area name, and fully supports "National" (ברחבי הארץ) alerts.
* **🛠️ Fully Customizable Webhook Templates**: Build your own JSON payload! Use a built-in interpolation engine to dynamically inject variables (`${city}`, `${timestamp}`, etc.) into the HTTP method, headers, and body.
* **🔄 Dynamic Alert Fallback**: Never miss an alert. If an unknown alert type occurs (not defined in your config), the script automatically forwards the official description (`desc`) provided by the Home Front Command.
* **⏱️ Smart Deduplication**: Prevents duplicate alerts *per city and alert type* within a configurable time window, ensuring you don't get spammed while not missing distinct events. Retains a 24-hour rolling history.
* **🔐 Secure Secrets (.env)**: Keep your API tokens, Bearer auth, and Webhook URLs safe by injecting them directly from a `.env` file into your payload templates.
* **⚡ Concurrent Dispatching**: Sends multiple webhooks simultaneously using `Promise.allSettled`, ensuring zero delays when a large barrage triggers multiple monitored cities at once.

---

## 🔧 Setup and Installation

> **⚠️ Important Requirement**
> This script **must** be run from a server with an **Israeli IP address**. The Home Front Command's API is geo-restricted and will not respond to requests from outside of Israel.

### 1. Clone the Repository

Clone this repository to your local machine or server and navigate into the directory:

```bash
git clone https://github.com/yosef-770/oref-alerts-webhook.git
cd oref-alerts-webhook
```

### 2. Install Dependencies

Install the required dependencies (`axios` and `dotenv`) using npm:

```bash
npm install axios dotenv
```

### 3. Create the Configuration Files

Create a `.env` file in the root directory to store your sensitive data:

```env
WEBHOOK_URL=https://your-external-server.com/webhook-endpoint
API_TOKEN=your_super_secret_token_here
```

Create a `config.json` file in the root directory and paste the following template:

```json
{
  "citiesToMonitor": [
    "בני ברק",
    "תל אביב - מרכז העיר",
    "רמת גן - מזרח",
    "גבעתיים"
  ],
  "webhookTarget": {
    "template": {
      "method": "POST",
      "headers": {
        "Content-Type": "application/json",
        "Authorization": "Bearer ${API_TOKEN}"
      },
      "body": {
        "alert_type": "${alertKey}",
        "location": "${city}",
        "message": "${content}",
        "timestamp": "${timestamp}",
        "source": "oref-alerts"
      }
    }
  },
  "monitoringIntervals": {
    "fetch_ms": 2000,
    "newAlertWindow_ms": 180000,
    "duplicateWindow_ms": 900000
  },
  "alertMappings": [
    {
      "key": "חדירת כלי טיס עוין",
      "message": "🛫 *חדירת כלי טיס עוין*"
    },
    {
      "key": "ירי רקטות וטילים",
      "message": "🚨 *צבע אדום*"
    },
    {
      "key": "שהייה בסמיכות למרחב מוגן",
      "message": "📡 *זוהתה פעילות המעידה על כוונה לשיגורים לעבר ישראל* \nיש להיערך להתראות אפשריות בזמן הקרוב"
    }
  ]
}
```

### 4. Customizing Your Webhook Template

The `webhookTarget.template` object allows you to structure the outgoing request exactly how your destination server expects it.

You can use the following dynamic variables anywhere in your headers or body:

* `${alertKey}` - The raw title of the alert (e.g., "ירי רקטות וטילים").
* `${city}` - The specific monitored city that triggered the alert.
* `${content}` - The custom message from your `alertMappings` (or the official Home Front Command fallback text).
* `${timestamp}` - The current time in ISO 8601 format.
* `${ANY_ENV_VAR}` - Any variable defined in your `.env` file (like `${API_TOKEN}`).

*(Note: If you omit the `template` object, the script will fall back to a simple default POST payload: `{ alertKey, city, content }`)*

---

## ▶️ Running the Script

After completing the setup, run the monitor from your terminal:

```bash
npm run start
```

To ensure the script runs continuously in the background (highly recommended for production servers), use a process manager like `pm2`:

```bash
# Install pm2 globally (if you haven't already)
npm install pm2 -g

# Start the script with pm2
pm2 start npm --name "Oref-Alerts" -- run start
```

---

## ⚠️ Disclaimer

This script works by polling the official Home Front Command's public alert history API, simulating the same data request made by the `oref.org.il` website. We utilize standard headers and cookie management to ensure stable fetching.

The code is designed to parse the current JSON structure provided by the Home Front Command's API. We are not responsible if this structure is changed in the future. However, this project is actively maintained, and we will strive to update the code accordingly should any changes occur.

---

## 🤝 Contributing

Suggestions, bug reports, and pull requests are welcome! Please feel free to open an issue if you encounter any problems or have ideas for improvements.

-----

## 🤝 Contributing

Suggestions, bug reports, and pull requests are welcome\! Please feel free to open an issue if you encounter any problems or have ideas for improvements.