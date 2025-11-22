const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const axios = require('axios');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());


// ======================================================================
// ROOT
// ======================================================================
app.get('/', (req, res) => {
  res.send('Backend is running.');
});


// ======================================================================
// SQLITE DATABASE (Safe initialization)
// ======================================================================
const db = new sqlite3.Database('./database.db', (err) => {
  if (err) {
    console.error("SQLite connection error:", err.message);
  } else {
    console.log("SQLite connected.");
  }
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      age INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS webhooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL
    )
  `);
});


// ======================================================================
// USERS CRUD
// ======================================================================
app.get('/users', (req, res) => {
  db.all("SELECT * FROM users", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

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


// ======================================================================
// WEBHOOKS
// ======================================================================
app.post('/webhooks', (req, res) => {
  const { url } = req.body;

  if (!url) return res.status(400).json({ error: "Webhook URL required" });

  db.run("INSERT INTO webhooks (url) VALUES (?)", [url], function (err) {
    if (err) return res.status(500).json({ error: err.message });

    res.json({ id: this.lastID, url });
  });
});

function notifyWebhooks(event, payload) {
  db.all("SELECT url FROM webhooks", [], async (err, rows) => {
    if (err) return console.error("Webhook DB error:", err);

    rows.forEach(async (row) => {
      try {
        await axios.post(row.url, { event, payload });
      } catch (e) {
        console.error("Webhook failed:", row.url);
      }
    });
  });
}


// ======================================================================
// SOCKET.IO
// ======================================================================
io.on("connection", (socket) => {
  console.log("Client connected");

  socket.on("disconnect", () => {
    console.log("Client disconnected");
  });
});


// ======================================================================
// START SERVER
// ======================================================================
server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
