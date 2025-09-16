
 🚀 Pikud Ha'Oref (Home Front Command) Alert Webhook

A simple and flexible Node.js script that monitors Israel's Home Front Command alerts in real-time and sends a custom webhook to an external server of your choice.

This tool allows you to define which cities to monitor, customize the message content for each alert type, and automatically react to alerts in your own systems (e.g., send messages to Telegram/Discord, activate PA systems, update a website status, and more).

-----

## ✨ Key Features

  * **📍 Monitor Multiple Cities**: Define a list of cities and regions to receive only relevant alerts.
  * **📄 Simple Configuration**: All settings are managed in an easy-to-edit external `config.json` file.
  * **🔗 Generic Webhook**: Sends a POST request with a structured payload to any URL you define. It is not tied to any specific service.
  * **✏️ Custom Messages**: You have full control over the message content sent for each type of alert.
  * **⏱️ Duplicate Prevention**: A smart mechanism prevents resending the same alert within a configured time window.
  * **📦 Minimal Dependency**: Requires only `axios` for HTTP communication.

-----

## 🔧 Setup and Installation

The setup process is simple and requires only a few steps.

> **⚠️ Important Requirement**
> This script **must** be run from a server with an **Israeli IP address**. The Home Front Command's API is geo-restricted and will not respond to requests from outside of Israel.

### 1\. Clone the Repository

Clone this repository to your local machine or server and navigate into the directory:

```bash
git clone https://github.com/yosef-770/oref-alerts-webhook.git
cd oref-alerts-webhook
```

### 2\. Install Dependencies

Install the required dependency (`axios`) using npm:

```bash
npm install
```

### 3\. Create the Configuration File

Create a new file in the project's root directory named `config.json`. Copy and paste the following template into it:

```json
{
  "citiesToMonitor": [
    "בני ברק",
    "תל אביב - מרכז העיר",
    "רמת גן - מזרח",
    "גבעתיים"
  ],
  "webhookTarget": {
    "url": "https://your-external-server.com/webhook-endpoint"
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
      "message":  "🚨 *צבע אדום*"
    },
    {
      "key": "שהייה בסמיכות למרחב מוגן",
      "message": "📡 *זוהה שיגור לעבר ישראל* \nיש להיערך להתראות אפשריות בזמן הקרוב"
    },
    {
        "key": "ירי רקטות וטילים -  האירוע הסתיים",
        "message": "ℹ️ *סיום התראה* \nלא מזוהה איום של שיגורים נוספים בטווח הזמן המיידי."
    }
  ]
}
```

### 4\. Edit Your Configuration

Modify the `config.json` file to fit your needs:

  * `citiesToMonitor`: Replace the example cities with the exact list of cities and regions you want to monitor.
  * `webhookTarget.url`: Paste the URL of your server that will receive the webhook.
  * `alertMappings`: Customize your alert messages. The `key` must be the **exact alert title text** from the Home Front Command. The `message` is the custom content that will be sent in the webhook payload.

-----

## ▶️ Running the Script

After completing the setup, run the monitor from your terminal:

```bash
node alert-monitor.js
```

To ensure the script runs continuously in the background (e.g., on a server), it is highly recommended to use a process manager like `pm2`:

```bash
# Install pm2 globally (if you haven't already)
npm install pm2 -g

# Start the script with pm2
pm2 start alert-monitor.js --name "Oref-Alerts"
```

-----

## 📦 Webhook Payload Structure

When a relevant alert is detected, the script will send a `POST` request to the URL you configured. The request body will be a JSON object with the following structure:

```json
{
  "alertKey": "The original alert title from the Home Front Command",
  "city": "The city where the alert was triggered",
  "content": "Your custom message from the config file"
}
```

For example, an alert for "ירי רקטות וטילים" in "Tel Aviv - Center" would send this payload:

```json
{
  "alertKey": "ירי רקטות וטילים",
  "city": "תל אביב - מרכז העיר",
  "content": "🚨 *צבע אדום*"
}
```

Your server should be prepared to receive and process data in this format.

-----

## ⚠️ Disclaimer

This script works by polling the official Home Front Command's public alert history API, simulating the same data request made by the `oref.org.il` website.

The code is designed to parse the current JSON structure provided by the Home Front Command's API. We are not responsible if this structure is changed in the future. However, this project is actively maintained, and we will strive to update the code accordingly should any changes occur.

-----

## 🤝 Contributing

Suggestions, bug reports, and pull requests are welcome\! Please feel free to open an issue if you encounter any problems or have ideas for improvements.