import { registerDevice } from "../src/remarkable.js";

const ALL_SITES = { origins: ["<all_urls>"] };
const $ = (id) => document.getElementById(id);

function status(text, kind = "") {
  $("status").textContent = text;
  $("status").className = kind;
}

async function render() {
  const { deviceToken } = await browser.storage.local.get("deviceToken");
  $("paired").hidden = !deviceToken;
  $("pairing").hidden = Boolean(deviceToken);
  $("permission").hidden = await browser.permissions.contains(ALL_SITES);
}

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
  await browser.storage.local.remove("deviceToken");
  status("Extension désappairée.");
  render();
});

$("grant").addEventListener("click", async () => {
  await browser.permissions.request(ALL_SITES);
  render();
});

render();
