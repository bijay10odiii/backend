const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const WebSocket = require('ws');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Discord webhook URL (replace with your actual one)
const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1447973219695853689/nBrVPCxNDpDKQEEpgqRBCtbtO9CKnxTcb-u9qxPbmQVyTvrmJ1Zd60SFF_IQCuSv5Zxa';
//  Thresholds for alerts
const TEMP_THRESHOLD = 30.0;   // °C
const HUM_THRESHOLD  = 20.0;   // %

const db = new sqlite3.Database('./data.db');
db.run(`CREATE TABLE IF NOT EXISTS readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  temperature REAL,
  humidity REAL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.get('/api/readings', (req, res) => {
  db.all('SELECT * FROM readings ORDER BY timestamp DESC', [], (err, rows) => {
    if (err) return res.status(500).send('DB error');
    res.json(rows);
  });
});

app.get('/api/latest', (req, res) => {
  db.get('SELECT * FROM readings ORDER BY timestamp DESC LIMIT 1', [], (err, row) => {
    if (err) return res.status(500).send('DB error');
    res.json(row || {});
  });
});

// Webhook route: receive sensor data, store, broadcast, and forward to Discord if threshold crossed
app.post('/webhook', (req, res) => {
  const { temperature, humidity } = req.body;
  console.log("Incoming payload:", req.body);

  db.run(
    'INSERT INTO readings (temperature, humidity) VALUES (?, ?)',
    [temperature, humidity],
    async (err) => {
      if (err) {
        console.error("DB error:", err);
        return res.status(500).send('DB error');
      }
      console.log("Inserted into DB:", { temperature, humidity });

      // Broadcast to WebSocket clients
      broadcast({ temperature, humidity });

      // ✅ Only forward to Discord if thresholds are crossed
      if (temperature > TEMP_THRESHOLD || humidity < HUM_THRESHOLD) {
        try {
          const msg = `⚠️ Alert! Temp=${temperature} °C | Hum=${humidity} %`;
          const response = await fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: msg })
          });
          if (!response.ok) {
            throw new Error(`Discord responded with ${response.status}`);
          }
          console.log("Alert sent to Discord:", msg);
        } catch (error) {
          console.error("Error sending to Discord:", error);
        }
      }

      res.status(200).send('Data received');
    }
  );
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// WebSocket setup
const wss = new WebSocket.Server({ server });

wss.on('connection', (socket) => {
  console.log("WebSocket client connected");
});

function broadcast(data) {
  const message = JSON.stringify(data);
  console.log("Broadcasting:", message);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}