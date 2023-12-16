const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database(":memory:");

const WebSocket = require("ws");
const crypto = require("crypto");
const NodeRSA = require("node-rsa");
const genName = require("./name");
db.exec(`CREATE TABLE IF NOT EXISTS "chat" (
            "id" INTEGER NOT NULL PRIMARY KEY,
            "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "room_id" INTEGER NOT NULL,
            "message" TEXT NOT NULL,
            "from" TEXT NOT NULL
        );`);
db.exec(`CREATE TABLE IF NOT EXISTS "room" (
            "id" INTEGER NOT NULL PRIMARY KEY,
            "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "name" TEXT NOT NULL,
            "to" TEXT NOT NULL,
            "from" TEXT NOT NULL,
            "key" TEXT NOT NULL
        );`);

let ws,
  running = true;

let RSAKEY = new NodeRSA({ b: 512 });
let RSAPUBKEY = RSAKEY.exportKey("public").split("\n").slice(1, -1).join("");
alert(RSAPUBKEY);
let roomid = 0;

const updateRoom = () => {
  let name = document.querySelector("#chatname");
  name.innerText = "";
  db.all(`SELECT * FROM room ORDER BY created_at DESC;`, [], (err, rows) => {
    if (err) {
      console.log(err);
      return;
    }
    let roomList = document.querySelector("#roomList");
    roomList.innerHTML = "";
    for (let row of rows) {
      console.log(row);
      roomList.innerHTML += `<li class="list-group-item ${
        roomid === row.id ? "selected-chat" : ""
      }" onclick="selectRoom(${row.id});">
          <strong>${row.name}</strong><br>
      </li>`;
      if (roomid === row.id) {
        name.innerText = row.name;
      }
    }
    updateChat();
  });
};
updateRoom();

const updateChat = () => {
  db.all(
    `SELECT * FROM chat WHERE room_id = ? ORDER BY created_at ASC;`,
    [roomid],
    (err, rows) => {
      if (err) {
        console.log(err);
        return;
      }
      let chatList = document.querySelector("#chatBox");
      chatList.innerHTML = "";
      for (let row of rows) {
        console.log(row);
        chatList.innerHTML += `<p><strong>${row.from.slice(
          -12,
          -2
        )}:</strong> ${
          row.message
        } <button class="btn btn-danger" onclick="deleteChat(${
          row.id
        })">X</button></p>`;
      }
      chatList.scrollTop = chatList.scrollHeight;
    }
  );
};
updateChat();

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
          pubkey: RSAPUBKEY,
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
          console.log("chat");
          // get room data from db
          db.get(
            `SELECT * FROM room WHERE id = ?;`,
            [message.d.roomId],
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
              let tmp = Buffer.from(row.key, "base64");
              const key = tmp.slice(16);
              const iv = tmp.slice(0, 16);
              const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
              let decrypted = decipher.update(
                message.d.message,
                "base64",
                "utf-8"
              );
              decrypted += decipher.final("utf-8");
              message.d.message = decrypted.toString("utf8");
              console.log(message);
              db.run(
                `INSERT INTO chat ("id", "room_id", "message", "from") VALUES (?, ?, ?, ?);`,
                [
                  message.d.id,
                  message.d.roomId,
                  message.d.message,
                  message.d.from,
                ],
                () => {
                  updateChat();
                }
              );
            }
          );
          break;
        case "room":
          console.log("room");
          console.log(message);
          let key = RSAKEY.decrypt(message.d.key, "base64");
          console.log(key);
          db.run(
            `INSERT INTO room ("id", "name", "to", "from", "key") VALUES (?, ?, ?, ?, ?);`,
            [message.d.id, message.d.name, message.d.to, message.d.from, key],
            () => {
              updateRoom();
            }
          );
          break;
        case "del-chat":
          console.log("del-chat");
          db.run(`DELETE FROM chat WHERE id = ?;`, [message.d.chatId], () => {
            updateChat();
          });
          break;
        case "del-room":
          console.log("del-room");
          db.run(`DELETE FROM room WHERE id = ?;`, [message.d.roomId], () => {
            updateRoom();
          });
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

const newRoom = async () => {
  let newRoomModal = bootstrap.Modal.getInstance(
    document.getElementById("newRoomModal")
  );
  let cancelButton = document.querySelector(
    "#newRoomModal .modal-footer > .btn-secondary"
  );
  let confirmButton = document.querySelector(
    "#newRoomModal .modal-footer > .btn-primary"
  );
  let input = document.querySelector("#newRoomModal .modal-body > input");
  cancelButton.setAttribute("disabled", "");
  confirmButton.innerHTML = '<div class="loader"></div>';
  confirmButton.setAttribute("disabled", "");
  input.setAttribute("disabled", "");

  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(16);

  let tmp = new NodeRSA();
  tmp.importKey(
    "-----BEGIN PUBLIC KEY-----\n" + input.value + "\n-----END PUBLIC KEY-----",
    "public"
  );

  let name = genName();
  let resp = await fetch("http://localhost:3000/api/room", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      to: input.value,
      from: RSAPUBKEY,
      key: tmp.encrypt(Buffer.concat([iv, key]), "base64"),
    }),
  });
  let json = await resp.json();
  console.log(json);

  db.run(
    `INSERT INTO room ("id", "name", "to", "from", "key") VALUES (?, ?, ?, ?, ?);`,
    [
      json.id,
      name,
      input.value,
      RSAPUBKEY,
      Buffer.concat([iv, key]).toString("base64"),
    ]
  );

  newRoomModal.hide();
  cancelButton.removeAttribute("disabled");
  confirmButton.innerHTML = "Confirm";
  confirmButton.removeAttribute("disabled");
  input.removeAttribute("disabled");
  input.value = "";
  updateRoom();
};
const deleteRoom = async () => {
  let deleteRoomModal = bootstrap.Modal.getInstance(
    document.getElementById("deleteRoomModal")
  );
  let cancelButton = document.querySelector(
    "#deleteRoomModal .modal-footer > .btn-secondary"
  );
  let deleteButton = document.querySelector(
    "#deleteRoomModal .modal-footer > .btn-danger"
  );
  cancelButton.setAttribute("disabled", "");
  deleteButton.innerHTML = '<div class="loader"></div>';
  deleteButton.setAttribute("disabled", "");

  db.run(`DELETE FROM room WHERE id = ?;`, [roomid]);
  await fetch("http://localhost:3000/api/room", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      roomId: roomid,
      from: RSAPUBKEY,
      sign: "sign",
    }),
  });

  deleteRoomModal.hide();
  cancelButton.removeAttribute("disabled");
  deleteButton.innerHTML = "Delete";
  deleteButton.removeAttribute("disabled");

  updateRoom();
};

const sendChat = async () => {
  let msg = document.querySelector("#content").value;
  db.get(`SELECT * FROM room WHERE id = ?;`, [roomid], async (err, row) => {
    console.log(row);
    let tmp = Buffer.from(row.key, "base64");
    const key = tmp.slice(16);
    const iv = tmp.slice(0, 16);
    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    let encrypted = cipher.update(msg, "utf8", "base64");
    encrypted += cipher.final("base64");
    v = encrypted.toString("utf8");
    let resp = await fetch("http://localhost:3000/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        roomId: roomid,
        message: v,
        from: RSAPUBKEY,
      }),
    });
    let json = await resp.json();
    console.log(json);
    db.run(
      `INSERT INTO chat ("id", "room_id", "message", "from") VALUES (?, ?, ?, ?);`,
      [json.id, roomid, msg, RSAPUBKEY]
    );
    updateChat();
  });
};

const deleteChat = async (id) => {
  db.run(`DELETE FROM chat WHERE id = ?;`, [id]);
  await fetch("http://localhost:3000/api/chat", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      roomId: roomid,
      chatId: id,
      sign: "sign",
    }),
  });
  updateChat();
};

document.querySelector("#newRoomButton").onclick = async () => {
  newRoom();
};

document.querySelector("#deleteRoomButton").onclick = async () => {
  deleteRoom();
};

document.querySelector("#send").onclick = async () => {
  sendChat();
};

module.exports = {
  selectRoom: (id) => {
    roomid = id;
    updateRoom();
  },
  deleteChat: (id) => {
    deleteChat(id);
  },
};
