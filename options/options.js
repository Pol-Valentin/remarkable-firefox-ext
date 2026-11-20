import { listFolders } from "../src/folders.js";
import { registerDevice, userToken } from "../src/remarkable.js";

const ALL_SITES = { origins: ["<all_urls>"] };
const $ = (id) => document.getElementById(id);
let loading = 0;

function status(text, kind = "") {
  $("status").textContent = text;
  $("status").className = kind;
}

function fillFolders(folders, selectedId) {
  const options = folders.map(({ id, path }) => new Option(path, id, false, id === selectedId));
  $("folder").replaceChildren(new Option("Racine", ""), ...options);
}

async function loadFolders(deviceToken, folder, folderCache) {
  const run = loading;
  const select = $("folder");
  select.disabled = true;
  fillFolders(folder ? [folder] : [], folder?.id);
  try {
    const list = await listFolders(await userToken(deviceToken), folderCache);
    if (run !== loading) return;
    const current = list.folders.find(({ id }) => id === folder?.id);
    fillFolders(list.folders, current?.id);
    if (folder && !current) status(`Le dossier « ${folder.path} » n'existe plus : les articles iront à la racine.`, "error");
    await browser.storage.local.set({ folderCache: list, ...(current && current.path !== folder.path && { folder: current }) });
  } catch (error) {
    if (run !== loading) return;
    if (error.status === 401) {
      await browser.storage.local.remove(["deviceToken", "folderCache"]);
      status("L'appairage a expiré : saisis un nouveau code ci-dessous.", "error");
      return render();
    }
    status(`Impossible de lire tes dossiers : ${error.message}`, "error");
  }
  select.disabled = false;
}

async function render() {
  const run = ++loading;
  const [{ deviceToken, folder, folderCache }, allSites] = await Promise.all([
    browser.storage.local.get(["deviceToken", "folder", "folderCache"]),
    browser.permissions.contains(ALL_SITES),
  ]);
  const showDestination = Boolean(deviceToken) && allSites;
  $("paired").hidden = !deviceToken;
  $("pairing").hidden = Boolean(deviceToken);
  $("permission").hidden = allSites;
  $("destination").hidden = !showDestination;
  if (showDestination && run === loading) await loadFolders(deviceToken, folder, folderCache);
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
  await browser.storage.local.remove(["deviceToken", "folder", "folderCache"]);
  status("Extension désappairée.");
  render();
});

$("grant").addEventListener("click", async () => {
  await browser.permissions.request(ALL_SITES);
  render();
});

render();
