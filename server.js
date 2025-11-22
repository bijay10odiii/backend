const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const axios = require('axios');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const port = 3000;

app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────
// ROOT ENDPOINT
// ─────────────────────────────────────────────
app.get('/', (req, res) => {
  res.send('Welcome to the server!');
});


// ─────────────────────────────────────────────
// SENSOR MOCK ENDPOINT (Also emits WebSocket events)
// ─────────────────────────────────────────────
app.get('/api/sensor', (req, res) => {
  const data = {
    temperature: 22.5 + Math.random() * 2,
    humidity: 55 + Math.random() * 3,
    status: "OK"
  };

  io.emit("sensor-update", data);
  notifyWebhooks("sensor_update", data);

  res.json(data);
});


// ─────────────────────────────────────────────
// SQLITE DATABASE
// ─────────────────────────────────────────────
const db = new sqlite3.Database('./database.db', (err) => {
  if (err) {
    console.error("Error connecting to SQLite:", err.message);
  } else {
    console.log("Connected to SQLite database.");
  }
});

db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    age INTEGER
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS webhooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT
  )
`);


// ─────────────────────────────────────────────
// GET USERS
// ─────────────────────────────────────────────
app.get('/users', (req, res) => {
  db.all("SELECT * FROM users", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});


// ─────────────────────────────────────────────
// POST USER (WebSocket + Webhook)
// ─────────────────────────────────────────────
app.post('/users', (req, res) => {
  const { name, age } = req.body;

  if (!name || !age) {
    return res.status(400).json({ error: "Name and age are required" });
  }

  db.run(
    "INSERT INTO users (name, age) VALUES (?, ?)",
    [name, age],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });

      const newUser = { id: this.lastID, name, age };

      io.emit("new-user", newUser);
      notifyWebhooks("new_user", newUser);

      res.json(newUser);
    }
  );
});


// ─────────────────────────────────────────────
// REGISTER WEBHOOK
// ─────────────────────────────────────────────
app.post('/webhooks', (req, res) => {
  const { url } = req.body;

  if (!url) return res.status(400).json({ error: "Webhook URL required" });

  db.run("INSERT INTO webhooks (url) VALUES (?)", [url], function (err) {
    if (err) return res.status(500).json({ error: err.message });

    res.json({ id: this.lastID, url });
  });
});


// ─────────────────────────────────────────────
// WEBHOOK SENDER
// ─────────────────────────────────────────────
function notifyWebhooks(event, payload) {
  db.all("SELECT url FROM webhooks", [], async (err, rows) => {
    if (err) return console.error("DB webhook fetch error:", err);

    rows.forEach(async (row) => {
      try {
        await axios.post(row.url, { event, payload });
        console.log("Webhook sent to:", row.url);
      } catch (e) {
        console.error("Webhook delivery failed:", row.url);
      }
    });
  });
}


// ─────────────────────────────────────────────
// DUMMY SENSOR DATA ENDPOINT
// ─────────────────────────────────────────────
app.get('/send-dummy', (req, res) => {
  const data = {
    temperature: 20 + Math.random() * 5,
    humidity: 40 + Math.random() * 20,
    status: "DUMMY"
  };

  io.emit("sensor-update", data);

  res.json({ message: "Dummy data sent!", data });
});


// ─────────────────────────────────────────────
// REAL-TIME DASHBOARD
// ─────────────────────────────────────────────
app.get('/dashboard', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Live Sensor Dashboard</title>
        <script src="/socket.io/socket.io.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>

        <style>
          body {
            background: #f5f7fa;
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 0;
            text-align: center;
          }
          h1 {
            background: #007bff;
            color: white;
            padding: 20px;
            margin: 0 0 20px 0;
          }
          .cards {
            display: flex;
            justify-content: center;
            gap: 25px;
            margin-bottom: 40px;
          }
          .card {
            background: white;
            padding: 20px;
            width: 200px;
            border-radius: 12px;
            box-shadow: 0 4px 10px rgba(0,0,0,0.1);
          }
          .value {
            font-size: 32px;
            font-weight: bold;
            margin-top: 10px;
            color: #333;
          }
          canvas {
            width: 90%;
            max-width: 800px;
            margin: auto;
          }
        </style>
      </head>

      <body>

        <h1>Live Sensor Dashboard</h1>

        <div class="cards">
          <div class="card">
            <h3>Temperature</h3>
            <div id="temp" class="value">--</div>
          </div>

          <div class="card">
            <h3>Humidity</h3>
            <div id="hum" class="value">--</div>
          </div>
        </div>

        <canvas id="sensorChart"></canvas>

        <script>
          const socket = io();

          const ctx = document.getElementById('sensorChart').getContext('2d');

          const chartData = {
            labels: [],
            datasets: [
              {
                label: "Temperature (°C)",
                data: [],
                borderWidth: 2,
                borderColor: "red",
                fill: false
              },
              {
                label: "Humidity (%)",
                data: [],
                borderWidth: 2,
                borderColor: "blue",
                fill: false
              }
            ]
          };

          const chartOptions = {
            scales: {
              y: { beginAtZero: false }
            }
          };

          const sensorChart = new Chart(ctx, {
            type: "line",
            data: chartData,
            options: chartOptions
          });

          socket.on("sensor-update", (data) => {
            document.getElementById("temp").textContent = data.temperature.toFixed(2);
            document.getElementById("hum").textContent = data.humidity.toFixed(2);

            const time = new Date().toLocaleTimeString();

            chartData.labels.push(time);
            chartData.datasets[0].data.push(data.temperature);
            chartData.datasets[1].data.push(data.humidity);

            if (chartData.labels.length > 20) {
              chartData.labels.shift();
              chartData.datasets[0].data.shift();
              chartData.datasets[1].data.shift();
            }

            sensorChart.update();
          });
        </script>

      </body>
    </html>
  `);
});



// ─────────────────────────────────────────────
// WEBSOCKETS
// ─────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log("Client connected");

  socket.on("disconnect", () => {
    console.log("Client disconnected");
  });
});


//comments to check runnuing
// ─────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────
server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
