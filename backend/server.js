// // 
// const express = require('express');
// const sqlite3 = require('sqlite3').verbose();
// const { WebSocketServer } = require('ws');

// const app = express();
// const port = 3000;

// // Middleware
// app.use(express.json());

// // Connect to SQLite
// const db = new sqlite3.Database('./sensor.db', (err) => {
//   if (err) return console.error(err.message);
//   console.log('Connected to SQLite database');
// });

// // Create table
// db.run(`
//   CREATE TABLE IF NOT EXISTS sensor (
//     id INTEGER PRIMARY KEY AUTOINCREMENT,
//     temperature REAL,
//     humidity REAL,
//     status TEXT,
//     timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
//   );
// `);

// // HTTP POST Endpoint (Optional Backup)
// app.post('/api/sensor', (req, res) => {
//   const { temperature, humidity, status } = req.body;
//   saveSensorData(temperature, humidity, status);
//   res.json({ message: "Sensor data saved via HTTP!" });
// });

// // HTTP GET
// app.get('/api/sensor', (req, res) => {
//   db.get(`SELECT * FROM sensor ORDER BY timestamp DESC LIMIT 1`, (err, row) => {
//     if (err) return res.status(500).json({ error: err.message });
//     res.json(row || {});
//   });
// });

// // Start HTTP Server
// const server = app.listen(port, () => {
//   console.log(`Server running at http://localhost:${port}`);
// });

// // ⬇️ WebSocket Server
// const wss = new WebSocketServer({ server });

// wss.on('connection', (ws) => {
//   console.log("New WebSocket connection!");

//   ws.on('message', (msg) => {
//     try {
//       const data = JSON.parse(msg.toString());
//       console.log("Received:", data);
//       saveSensorData(data.temp, data.humidity, "OK");

//       // Broadcast to all connected clients (Frontend Dashboards)
//       broadcast(JSON.stringify(data));
//     } catch {
//       console.log("Invalid message:", msg.toString());
//     }
//   });
// });

// // Save to DB function
// function saveSensorData(temp, humidity, status = "OK") {
//   db.run(
//     `INSERT INTO sensor (temperature, humidity, status) VALUES (?, ?, ?)`,
//     [temp, humidity, status],
//     (err) => err && console.error("DB Error:", err.message)
//   );
// }

// // Broadcast to all dashboards
// function broadcast(msg) {
//   wss.clients.forEach(ws => ws.send(msg));
// }


// ================== IMPORTS ==================
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const WebSocket = require('ws');
const bodyParser = require('body-parser');

// ================== APP SETUP ==================
const app = express();
const port = 3000;

app.use(express.json());
app.use(bodyParser.json());

// ================== SQLITE DATABASE ==================
const db = new sqlite3.Database('./sensor.db', (err) => {
  if (err) return console.error(err.message);
  console.log('Connected to SQLite database');
});

// Create table if it does not exist
db.run(`
  CREATE TABLE IF NOT EXISTS sensor (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    temperature REAL,
    humidity REAL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ================== EXPRESS API ==================

// Save data manually by HTTP (optional)
app.post('/api/sensor', (req, res) => {
  const { temperature, humidity } = req.body;

  db.run(
    `INSERT INTO sensor (temperature, humidity) VALUES (?, ?)`,
    [temperature, humidity],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Sensor data saved!", id: this.lastID });
    }
  );
});

// Get latest sensor data (for testing)
app.get('/api/sensor', (req, res) => {
  db.get(`SELECT * FROM sensor ORDER BY timestamp DESC LIMIT 1`, (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(row || {});
  });
});

// ================== WEBSOCKET SERVER ==================
const wss = new WebSocket.Server({ port: 3001 });

wss.on('connection', (ws) => {
  console.log('Frontend connected to WebSocket!');
  
  ws.on('close', () => console.log('Frontend Disconnected!'));
});

// Broadcast to all connected frontend clients
function broadcast(data) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// ================== HANDLE ESP32 WEBSOCKET DATA ==================
const esp32 = new WebSocket.Server({ port: 3002 });

esp32.on('connection', (ws) => {
  console.log('ESP32 connected!');

  ws.on('message', (msg) => {
    console.log("Data from ESP32:", msg.toString());
    const data = JSON.parse(msg.toString());

    // Save to SQLite
    db.run(
      `INSERT INTO sensor (temperature, humidity) VALUES (?, ?)`,
      [data.temperature, data.humidity]
    );

    // Broadcast to frontend
    broadcast(data);
  });

  ws.on('close', () => console.log('ESP32 disconnected!'));
});

// ================== START EXPRESS SERVER ==================
app.listen(port, () => {
  console.log(`HTTP API running at http://localhost:${port}`);
  console.log(`WebSocket for Frontend: ws://localhost:3001`);
  console.log(`WebSocket for ESP32: ws://localhost:3002`);
});
