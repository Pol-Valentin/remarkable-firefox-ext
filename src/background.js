import { toXhtml } from "./article.js";
import { buildEpub } from "./epub.js";
import { fetchImage } from "./images.js";
import { resolveParent } from "./folders.js";
import { uploadEpub, userToken } from "./remarkable.js";

const ALL_SITES = { origins: ["<all_urls>"] };
const PAIRING_EXPIRED = "L'appairage a expiré : saisis un nouveau code dans les options.";
const LINK_TIMEOUT = 30000;
const POLL_INTERVAL = 1000;
const EXTRACT_ATTEMPTS = 8;

browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: "send-to-remarkable",
    title: "Envoyer la page sur reMarkable",
    contexts: ["page", "selection"],
  });
  browser.contextMenus.create({
    id: "send-link",
    title: "Envoyer le lien sur reMarkable",
    contexts: ["link"],
    targetUrlPatterns: ["http://*/*", "https://*/*"],
  });
});

browser.action.onClicked.addListener((tab) => send(tab));
browser.contextMenus.onClicked.addListener((info, tab) => (info.menuItemId === "send-link" ? sendLink(info.linkUrl, tab) : send(tab)));

async function badge(tabId, text, color) {
  try {
    await browser.action.setBadgeBackgroundColor({ tabId, color });
    await browser.action.setBadgeText({ tabId, text });
  } catch {}
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function notify(title, message) {
  return browser.notifications.create({ type: "basic", iconUrl: browser.runtime.getURL("icons/icon.svg"), title, message });
}

async function extract(tabId) {
  const results = await browser.scripting.executeScript({
    target: { tabId },
    files: ["vendor/Readability.js", "src/extract.js"],
  });
  const article = results.at(-1)?.result;
  if (!article) throw new Error("Impossible de lire cette page.");
  if (article.error) throw new Error(article.error);
  return article;
}

async function fetchFromPage(tabId, url) {
  const [{ result }] = await browser.scripting.executeScript({
    target: { tabId },
    func: async (src) => {
      const response = await content.fetch(src);
      if (!response.ok) return null;
      return { type: response.headers.get("Content-Type") ?? "", bytes: await response.arrayBuffer() };
    },
    args: [url],
  });
  return result;
}

async function loaded(tabId) {
  for (let waited = 0; waited < LINK_TIMEOUT; waited += POLL_INTERVAL) {
    const tab = await browser.tabs.get(tabId);
    if (tab.status === "complete" && tab.url) return;
    await pause(POLL_INTERVAL);
  }
  throw new Error("La page du lien ne s'est pas chargée à temps.");
}

async function extractPatiently(tabId) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await extract(tabId);
    } catch (error) {
      if (attempt === EXTRACT_ATTEMPTS) throw error;
      await pause(POLL_INTERVAL);
    }
  }
}

async function closeIfHidden(tabId) {
  const tab = await browser.tabs.get(tabId).catch(() => null);
  if (tab && !tab.active) await browser.tabs.remove(tabId);
}

async function settings() {
  const { deviceToken, folder } = await browser.storage.local.get(["deviceToken", "folder"]);
  if (deviceToken && (await browser.permissions.contains(ALL_SITES))) return { deviceToken, folder };
  await browser.runtime.openOptionsPage();
  return null;
}

export async function send(tab) {
  const config = await settings();
  if (config) await deliver(config, { pageTabId: tab.id });
}

export async function sendLink(url, origin) {
  const config = await settings();
  if (!config) return;
  let tab;
  try {
    tab = await browser.tabs.create({ url, active: false });
    await loaded(tab.id);
    await deliver(config, { pageTabId: tab.id, badgeTabId: origin.id, read: extractPatiently });
  } catch (error) {
    await fail(origin.id, error);
  } finally {
    if (tab) await closeIfHidden(tab.id);
  }
}

async function fail(badgeTabId, error) {
  const expired = error.status === 401;
  if (expired) {
    await browser.storage.local.remove("deviceToken");
    await browser.runtime.openOptionsPage();
  }
  await badge(badgeTabId, "!", "#c62828");
  await notify("Échec de l'envoi sur reMarkable", expired ? PAIRING_EXPIRED : error.message);
}

async function deliver({ deviceToken, folder }, { pageTabId, badgeTabId = pageTabId, read = extract }) {
  await badge(badgeTabId, "…", "#666");
  const token = userToken(deviceToken);
  const parent = token.then((t) => resolveParent(t, folder)).then(
    (id) => ({ id }),
    () => ({ id: "", unchecked: true }),
  );
  token.catch(() => {});
  try {
    const article = await read(pageTabId);
    const { bodyXhtml, images } = await toXhtml(article.content, (url) => fetchImage(url, (src) => fetchFromPage(pageTabId, src)));
    const epub = buildEpub({
      id: `urn:uuid:${crypto.randomUUID()}`,
      title: article.title,
      author: article.byline || article.siteName,
      lang: article.lang,
      source: article.url,
      modified: new Date(),
      bodyXhtml,
      images,
    });
    const destination = await parent;
    await uploadEpub(await token, article.title, epub, destination.id);
    await badge(badgeTabId, "✓", "#2e7d32");
    setTimeout(() => browser.action.setBadgeText({ tabId: badgeTabId, text: "" }).catch(() => {}), 4000);
    if (folder && !destination.id) {
      const reason = destination.unchecked ? "n'a pas pu être vérifié" : "n'existe plus";
      await notify("Article envoyé à la racine", `Le dossier « ${folder.path} » ${reason} : l'article est à la racine.`);
    }
  } catch (error) {
    await fail(badgeTabId, error);
  }
}
