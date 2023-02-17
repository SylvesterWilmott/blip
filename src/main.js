"use strict";

const { app, Menu, Tray, dialog, shell, nativeImage } = require("electron");

const fs = require("fs");
const path = require("path");
const Store = require("electron-store");
const strings = require(path.join(__dirname, "strings.js"));

let tray;
let menu;
let userPrefs = {};
let dialogIsOpen = false;

const defaults = {
  favourites: [],
  pref_open_at_login: true,
};

const storage = new Store({ defaults });

app.on("ready", async function () {
  app.dock.hide();
  getUserPrefs();
  setupTray();
  await buildMenu();
  registerListeners();
  setupAppSettings();
});

function getUserPrefs() {
  for (const key in defaults) {
    userPrefs[key] = storage.get(key);
  }
}

function setupTray() {
  tray = new Tray(path.join(__dirname, "images/ic_Template.png"));
}

async function buildMenu() {
  let menuTemplate = [];

  const addTemplate = [
    {
      label: strings.ADD,
      accelerator: "Command+N",
      click: () => chooseFavourite(),
    },
    { type: "separator" },
  ];

  const otherTemplate = [
    {
      label: strings.PREFERENCES,
      submenu: [
        {
          label: strings.OPEN_AT_LOGIN,
          id: "pref_open_at_login",
          type: "checkbox",
          checked: false,
          click: (menuItem) =>
            storage.set("pref_open_at_login", menuItem.checked),
        },
      ],
    },
    { type: "separator" },
    {
      role: "quit",
      label: strings.QUIT,
      accelerator: "Command+Q",
    },
  ];

  menuTemplate.push(addTemplate);
  if (userPrefs.favourites.length) {
    const map = await Promise.all(
      userPrefs.favourites.map(getFavouriteMenuItem)
    );

    const favouritesTemplate = [
      ...map,
      { type: "separator" },
      {
        label: strings.CLEAR_ALL,
        accelerator: "Command+Backspace",
        click: () => clearFavourites(),
      },
    ];

    menuTemplate.push(favouritesTemplate);
  }
  menuTemplate.push(otherTemplate);

  const finalTemplate = Array.prototype.concat(...menuTemplate);

  menu = Menu.buildFromTemplate(finalTemplate);
  tray.setContextMenu(menu);

  loadPreferences();
}

function loadPreferences() {
  const re = new RegExp("^pref_", "g");

  for (const key in userPrefs) {
    if (key.match(re)) {
      if (typeof userPrefs[key] == "boolean") {
        menu.getMenuItemById(key).checked = userPrefs[key];
      }
    }
  }
}

function chooseFavourite() {
  if (dialogIsOpen === false) {
    dialogIsOpen = true;
    dialog
      .showOpenDialog({
        message: strings.CHOOSE_PROMPT,
        buttonLabel: strings.CHOOSE,
        properties: ["openFile", "openDirectory", "multiSelections"],
      })
      .then((result) => {
        if (result.canceled) {
          dialogIsOpen = false;
          return;
        }

        addToFavourites(result.filePaths);
        dialogIsOpen = false;
      })
      .catch((err) => {
        console.log(err);
        dialogIsOpen = false;
      });
  }
}

function addToFavourites(filePaths) {
  const newFavourites = [];
  const rejected = [];

  for (const f of filePaths) {
    const isAFavourite = userPrefs.favourites.find((x) => x.path === f);

    if (isAFavourite) {
      rejected.push(f);
    } else {
      newFavourites.push(f);
    }
  }

  if (rejected.length) {
    const rejectedArr = [];

    for (const item of rejected) {
      rejectedArr.push(item);
    }

    const rejectedArrToStr =
      rejectedArr.length > 1
        ? rejectedArr.slice(0, -1).join(",") + " and " + rejectedArr.slice(-1)
        : rejectedArr.toString();

    const rejectedStr =
      rejectedArr.length > 1
        ? `The files/folders "${rejectedArrToStr}" are already added`
        : `The file/folder "${rejectedArrToStr}" is already added`;

    dialog
      .showMessageBox({
        message: strings.ALREADY_EXISTS,
        detail: rejectedStr,
        type: "info",
        buttons: ["OK"],
        defaultId: 0,
      })
      .then(() => {
        updateUserFavourites(newFavourites);
      })
      .catch((err) => {
        console.log(err);
      });

    return;
  }

  updateUserFavourites(newFavourites);
}

function updateUserFavourites(newFavourites) {
  const updatedFavourites = [...userPrefs.favourites];

  for (const f of newFavourites) {
    const favourite = getFavouriteObj(f);
    updatedFavourites.push(favourite);
  }

  storage.set("favourites", updatedFavourites);
}

function getFavouriteObj(filePath) {
  const name = path.parse(filePath).name;
  const ext = path.extname(filePath).toLowerCase();
  const truncated = getTruncatedFilename(name, ext);

  const favourite = {
    name: truncated,
    path: filePath,
  };

  if (ext === ".app") {
    favourite.type = "app";
  } else if (isDir(filePath)) {
    favourite.type = "dir";
  } else {
    favourite.type = "file";
  }

  return favourite;
}

function isDir(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    return stat.isDirectory();
  } catch (e) {
    return false;
  }
}

function getTruncatedFilename(name, ext) {
  const maxChars = 25;

  if (name.length > maxChars) {
    const start = name.substring(0, maxChars / 2).trim();
    const end = name.substring(name.length - maxChars / 2, name.length).trim();
    return `${start}...${end}${ext}`;
  }

  return `${name}${ext}`;
}

function clearFavourites() {
  const updatedFavourites = [];
  storage.set("favourites", updatedFavourites);
}

async function getFavouriteMenuItem(obj, i) {
  let subMenuItem = [];

  const open = {
    label: strings.OPEN,
    click: () => handleFile(obj.path, i, "open"),
  };

  const show = {
    label: strings.OPEN_IN_FOLDER,
    click: () => handleFile(obj.path, i, "show"),
  };

  const remove = {
    label: strings.REMOVE,
    click: () => removeFavourite(i),
  };

  if (obj.type === "dir") {
    subMenuItem.push(open, { type: "separator" }, remove);
  } else {
    subMenuItem.push(open, show, { type: "separator" }, remove);
  }

  let menuItem = {
    label: obj.name,
    submenu: subMenuItem,
  };

  if (obj.type === "dir" || obj.type === "app") {
    try {
      const icon = await nativeImage.createThumbnailFromPath(obj.path, {
        width: 16,
        height: 16,
      });

      menuItem.icon = icon;
    } catch (err) {
      console.error(err);
    }
  } else {
    try {
      const icon = await app.getFileIcon(obj.path, { size: "small" });

      menuItem.icon = icon;
    } catch (err) {
      console.error(err);
    }
  }

  return menuItem;
}

function handleFile(filePath, i, action) {
  if (!fs.existsSync(filePath)) {
    dialog
      .showMessageBox({
        message: strings.FILE_NOT_FOUND,
        detail: strings.FILE_NOT_FOUND_DETAIL,
        type: "question",
        buttons: [strings.FIND_FILE, strings.REMOVE],
        defaultId: 0,
      })
      .then((result) => {
        if (result.response === 0) {
          findFile(i);
        } else if (result.response === 1) {
          removeFavourite(i);
        }
      })
      .catch((err) => {
        console.log(err);
      });

    return;
  }

  if (action === "open") {
    shell.openPath(filePath);
  } else {
    shell.showItemInFolder(filePath);
  }
}

function findFile(i) {
  if (dialogIsOpen === false) {
    dialogIsOpen = true;
    dialog
      .showOpenDialog({
        message: strings.CHOOSE_PROMPT,
        buttonLabel: strings.CHOOSE,
        properties: ["openFile", "openDirectory"],
      })
      .then((result) => {
        if (result.canceled) {
          dialogIsOpen = false;
          return;
        }

        const newFilepath = result.filePaths[0];
        const updatedFavourites = [...userPrefs.favourites];
        const newFavourite = getFavouriteObj(newFilepath);

        updatedFavourites[i] = newFavourite;

        storage.set("favourites", updatedFavourites);

        dialogIsOpen = false;
      })
      .catch((err) => {
        console.log(err);
        dialogIsOpen = false;
      });
  }
}

function removeFavourite(i) {
  if (i > -1) {
    const updatedFavourites = [...userPrefs.favourites];
    updatedFavourites.splice(i, 1);
    storage.set("favourites", updatedFavourites);
  }
}

function registerListeners() {
  tray.on("drop-files", (e, files) => {
    addToFavourites(files);
  });

  storage.onDidAnyChange((result) => {
    for (const key in defaults) {
      userPrefs[key] = result[key];
    }
  });

  storage.onDidChange("pref_open_at_login", (status) => {
    setLoginSettings(status);
  });

  storage.onDidChange("favourites", (result) => {
    buildMenu();
  });
}

function setupAppSettings() {
  const openAtLoginStatus = app.getLoginItemSettings().openAtLogin;

  if (openAtLoginStatus !== userPrefs.pref_open_at_login) {
    setLoginSettings(userPrefs.pref_open_at_login);
  }
}

function setLoginSettings(status) {
  app.setLoginItemSettings({
    openAtLogin: status,
  });
}