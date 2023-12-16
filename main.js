const { app, BrowserWindow } = require("electron");
const path = require("path");
// const engine = require("./engine");

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    minWidth: 1000,
    width: 1000,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.loadFile("index.html");
  return mainWindow;
};

app.whenReady().then(() => {
  const window = createWindow();
  // engine.setWindow(window);
  // engine.start();

  // ipcMain.on("test", (event, message) => {
  //   console.log(message);
  //   event.reply("test", "pong");
  // });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // if (process.platform !== "darwin") app.quit();
  // engine.stop();
  app.quit();
});
