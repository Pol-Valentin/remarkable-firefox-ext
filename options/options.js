import { listFolders } from "../src/folders.js";
import { registerDevice, userToken } from "../src/remarkable.js";

const ALL_SITES = { origins: ["<all_urls>"] };
const $ = (id) => document.getElementById(id);

function status(text, kind = "") {
  $("status").textContent = text;
  $("status").className = kind;
}

const ROOT = () => new Option("Racine", "");

async function loadFolders(deviceToken) {
  const select = $("folder");
  const { folder } = await browser.storage.local.get("folder");
  select.disabled = true;
  select.replaceChildren(ROOT(), ...(folder ? [new Option(folder.path, folder.id, true, true)] : []));
  try {
    const folders = await listFolders(await userToken(deviceToken));
    const current = folders.find(({ id }) => id === folder?.id);
    select.replaceChildren(ROOT(), ...folders.map(({ id, path }) => new Option(path, id, false, id === current?.id)));
    if (folder && !current) status(`Le dossier « ${folder.path} » n'existe plus : les articles iront à la racine.`, "error");
    if (current && current.path !== folder.path) await browser.storage.local.set({ folder: current });
  } catch (error) {
    status(`Impossible de lire tes dossiers : ${error.message}`, "error");
  }
  select.disabled = false;
}

async function render() {
  const { deviceToken } = await browser.storage.local.get("deviceToken");
  const allSites = await browser.permissions.contains(ALL_SITES);
  $("paired").hidden = !deviceToken;
  $("pairing").hidden = Boolean(deviceToken);
  $("permission").hidden = allSites;
  $("destination").hidden = !deviceToken || !allSites;
  if (deviceToken && allSites) await loadFolders(deviceToken);
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
