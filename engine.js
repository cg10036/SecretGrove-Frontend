const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./db.sqlite");
const WebSocket = require("ws");
const crypto = require("crypto");
const { ipcMain } = require("electron");
let ws,
  running = true,
  key = { pub: null, priv: null },
  window;

db.exec(`CREATE TABLE IF NOT EXISTS "chat" (
    "id" INTEGER NOT NULL PRIMARY KEY,
    "created_at" DATETIME NOT NULL,
    "room_id" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "from" TEXT NOT NULL
);`);
db.exec(`CREATE TABLE IF NOT EXISTS "room" (
    "id" INTEGER NOT NULL PRIMARY KEY,
    "created_at" DATETIME NOT NULL,
    "name" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "key" TEXT NOT NULL
);`);

crypto.generateKeyPair(
  "ec",
  {
    namedCurve: "secp224r1",
    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
    },
  },
  (err, publicKey, privateKey) => {
    if (err) {
      console.error(err);
      return;
    }

    publicKey = publicKey.split("\n").slice(1, -2).join("");
    privateKey = privateKey.split("\n").slice(1, -2).join("");
    key.pub = publicKey;
    key.priv = privateKey;
    console.log(key);
  }
);

ipcMain.on("key", (event) => {
  event.reply("key", JSON.stringify(key));
});

const textDecoder = new TextDecoder();
const connect = () => {
  if (!running) return;
  ws = new WebSocket("ws://localhost:3001");
  ws.on("open", () => {
    console.log("Connected to server");
    ws.send(
      JSON.stringify({
        i: 1,
        c: "login",
        d: {
          pubkey: key.pub,
        },
      })
    );
  });
  ws.on("message", (message) => {
    try {
      message = textDecoder.decode(message);
      message = JSON.parse(message);
      console.log(message);
      switch (message.c) {
        case "chat":
          // get room data from db
          db.get(
            `SELECT * FROM room WHERE id = ?;`,
            [message.room_id],
            (err, row) => {
              if (err) {
                console.log(err);
                return;
              }
              if (!row) {
                console.log("No room found");
                return;
              }
              // decrypt message
              const decrypted = crypto.privateDecrypt(
                {
                  key: key.priv,
                  passphrase: row.key,
                },
                Buffer.from(message.message, "base64")
              );
              message.message = decrypted.toString("utf8");
              console.log(message);
              db.run(
                `INSERT INTO chat (created_at, room_id, message, from) VALUES (?, ?, ?, ?);`,
                [
                  message.created_at,
                  message.room_id,
                  message.message,
                  message.from,
                ]
              );
              // send message to renderer
              ipcMain.emit("chat", message);
            }
          );
          break;
        case "room":
          db.run(
            `INSERT INTO room (created_at, name, to, from, key) VALUES (?, ?, ?, ?, ?);`,
            [
              message.created_at,
              message.name,
              message.to,
              message.from,
              message.key,
            ]
          );
          break;
        case "del-chat":
          db.run(`DELETE FROM chat WHERE id = ?;`, [message.id]);
          break;
        case "del-room":
          db.run(`DELETE FROM room WHERE id = ?;`, [message.id]);
          break;
      }
    } catch (e) {
      console.log(e);
    }
  });
  ws.on("close", () => {
    console.log("Disconnected from server");
    if (running) {
      console.log("Reconnecting...");
    }
  });
  ws.on("error", (error) => {
    console.log(error);
    ws.close();
    setTimeout(() => {
      connect();
    }, 1000);
  });
};
connect();

const stop = () => {
  running = false;
  ws.close();
  db.close();
};

const setWindow = (_window) => {
  window = _window;
};

const start = () => {
  //   window.webContents.send("key", JSON.stringify(key));
};

module.exports = { stop, setWindow, start };
