import { listFolders } from "../src/folders.js";
import { registerDevice, userToken } from "../src/remarkable.js";

const ALL_SITES = { origins: ["<all_urls>"] };
const $ = (id) => document.getElementById(id);

function status(text, kind = "") {
  $("status").textContent = text;
  $("status").className = kind;
}

function fillFolders(folders, selectedId) {
  const options = folders.map(({ id, path }) => new Option(path, id, false, id === selectedId));
  $("folder").replaceChildren(new Option("Racine", ""), ...options);
}

async function loadFolders(deviceToken, folder) {
  const select = $("folder");
  select.disabled = true;
  fillFolders(folder ? [folder] : [], folder?.id);
  try {
    const folders = await listFolders(await userToken(deviceToken));
    const current = folders.find(({ id }) => id === folder?.id);
    fillFolders(folders, current?.id);
    if (folder && !current) status(`Le dossier « ${folder.path} » n'existe plus : les articles iront à la racine.`, "error");
    if (current && current.path !== folder.path) await browser.storage.local.set({ folder: current });
  } catch (error) {
    status(`Impossible de lire tes dossiers : ${error.message}`, "error");
  }
  select.disabled = false;
}

async function render() {
  const [{ deviceToken, folder }, allSites] = await Promise.all([
    browser.storage.local.get(["deviceToken", "folder"]),
    browser.permissions.contains(ALL_SITES),
  ]);
  const showDestination = Boolean(deviceToken) && allSites;
  $("paired").hidden = !deviceToken;
  $("pairing").hidden = Boolean(deviceToken);
  $("permission").hidden = allSites;
  $("destination").hidden = !showDestination;
  if (showDestination) await loadFolders(deviceToken, folder);
}

$("folder").addEventListener("change", async () => {
  const option = $("folder").selectedOptions[0];
  if (option.value) await browser.storage.local.set({ folder: { id: option.value, path: option.text } });
  else await browser.storage.local.remove("folder");
  status(`Les articles iront dans « ${option.text} ».`, "ok");
});

$("pair-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = $("code").value.trim().toLowerCase();
  if (code.length !== 8) return status("Le code fait 8 lettres.", "error");
  status("Appairage en cours…");
  try {
    const deviceToken = await registerDevice(code);
    await browser.storage.local.set({ deviceToken });
    $("code").value = "";
    status("Appairage réussi.", "ok");
  } catch (error) {
    status(error.message, "error");
  }
  render();
});

$("unpair").addEventListener("click", async () => {
  await browser.storage.local.remove(["deviceToken", "folder"]);
  status("Extension désappairée.");
  render();
});

$("grant").addEventListener("click", async () => {
  await browser.permissions.request(ALL_SITES);
  render();
});

render();
