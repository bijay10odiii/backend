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
// SQLITE DATABASE
// ======================================================================
const db = new sqlite3.Database('./database.db', (err) => {
  if (err) console.error("SQLite connection error:", err.message);
  else console.log("SQLite connected.");
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
// USERS API
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
      res.json(newUser);
    }
  );
});

// ======================================================================
// WEBHOOK API
// ======================================================================
app.post('/webhooks', (req, res) => {
  const { url } = req.body;

  if (!url) return res.status(400).json({ error: "Webhook URL required" });

  db.run("INSERT INTO webhooks (url) VALUES (?)", [url], function (err) {
    if (err) return res.status(500).json({ error: err.message });

    res.json({ id: this.lastID, url });
  });
});

// ======================================================================
// FRONTEND PAGE (UI)
// ======================================================================
app.get('/frontend', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>User Dashboard</title>
        <script src="/socket.io/socket.io.js"></script>

        <style>
          body {
            font-family: Arial;
            max-width: 800px;
            margin: 30px auto;
          }
          h1 { text-align: center; }
          .card {
            padding: 20px;
            background: #f5f5f5;
            border-radius: 8px;
            margin-bottom: 20px;
          }
          input, button {
            padding: 10px;
            margin: 5px;
            font-size: 16px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
          }
          table, th, td {
            border: 1px solid #ddd;
          }
          th, td {
            padding: 10px;
            text-align: left;
          }
        </style>
      </head>

      <body>

        <h1>User Management</h1>

        <!-- Add User Form -->
        <div class="card">
          <h2>Add User</h2>
          <input id="name" placeholder="Name" />
          <input id="age" type="number" placeholder="Age" />
          <button onclick="addUser()">Add</button>
        </div>

        <!-- User List -->
        <div class="card">
          <h2>Users</h2>
          <table id="userTable">
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Age</th>
            </tr>
          </table>
        </div>

        <script>
          const socket = io();

          // Fetch users on load
          async function loadUsers() {
            const res = await fetch("/users");
            const users = await res.json();

            const table = document.getElementById("userTable");

            table.innerHTML = \`
              <tr><th>ID</th><th>Name</th><th>Age</th></tr>
            \`;

            users.forEach(u => {
              table.innerHTML += \`
                <tr>
                  <td>\${u.id}</td>
                  <td>\${u.name}</td>
                  <td>\${u.age}</td>
                </tr>
              \`;
            });
          }

          loadUsers();

          // Add user
          async function addUser() {
            const name = document.getElementById("name").value;
            const age = document.getElementById("age").value;

            const res = await fetch("/users", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name, age })
            });

            const data = await res.json();
            console.log("Added:", data);

            loadUsers();
          }

          // Real-time user updates
          socket.on("new-user", (user) => {
            loadUsers();
          });
        </script>

      </body>
    </html>
  `);
});

// ======================================================================
// SOCKET.IO
// ======================================================================
io.on("connection", () => console.log("Client connected"));

// ======================================================================
// START SERVER
// ======================================================================
server.listen(port, () => {
  console.log("Server running on port " + port);
});
