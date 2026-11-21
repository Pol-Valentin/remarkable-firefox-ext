import { toXhtml } from "./article.js";
import { buildEpub } from "./epub.js";
import { fetchImage } from "./images.js";
import { resolveParent } from "./folders.js";
import { uploadEpub, userToken } from "./remarkable.js";

const ALL_SITES = { origins: ["<all_urls>"] };
const PAIRING_EXPIRED = "L'appairage a expiré : saisis un nouveau code dans les options.";
const LINK_TIMEOUT = 30000;

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
  });
});

browser.action.onClicked.addListener((tab) => send(tab));
browser.contextMenus.onClicked.addListener((info, tab) => (info.menuItemId === "send-link" ? sendLink(info.linkUrl, tab) : send(tab)));

async function badge(tabId, text, color) {
  await browser.action.setBadgeBackgroundColor({ tabId, color });
  await browser.action.setBadgeText({ tabId, text });
}

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

function loaded(tabId) {
  return new Promise((resolve, reject) => {
    const done = (outcome) => {
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(onUpdated);
      outcome();
    };
    const timer = setTimeout(() => done(() => reject(new Error("La page du lien ne s'est pas chargée à temps."))), LINK_TIMEOUT);
    const onUpdated = (id, change) => id === tabId && change.status === "complete" && done(resolve);
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.get(tabId).then((tab) => tab.status === "complete" && done(resolve), (error) => done(() => reject(error)));
  });
}

async function settings() {
  const { deviceToken, folder } = await browser.storage.local.get(["deviceToken", "folder"]);
  if (deviceToken && (await browser.permissions.contains(ALL_SITES))) return { deviceToken, folder };
  await browser.runtime.openOptionsPage();
  return null;
}

export async function send(tab) {
  const config = await settings();
  if (config) await deliver(config, tab.id, tab.id);
}

export async function sendLink(url, origin) {
  const config = await settings();
  if (!config) return;
  const tab = await browser.tabs.create({ url, active: false });
  try {
    await loaded(tab.id);
  } catch (error) {
    await notify("Échec de l'envoi sur reMarkable", error.message);
    return browser.tabs.remove(tab.id);
  }
  await deliver(config, tab.id, origin.id);
  await browser.tabs.remove(tab.id);
}

async function deliver({ deviceToken, folder }, pageTabId, badgeTabId) {
  await badge(badgeTabId, "…", "#666");
  const token = userToken(deviceToken);
  const parent = token.then((t) => resolveParent(t, folder)).then(
    (id) => ({ id }),
    () => ({ id: "", unchecked: true }),
  );
  token.catch(() => {});
  try {
    const article = await extract(pageTabId);
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
    setTimeout(() => browser.action.setBadgeText({ tabId: badgeTabId, text: "" }), 4000);
    if (folder && !destination.id) {
      const reason = destination.unchecked ? "n'a pas pu être vérifié" : "n'existe plus";
      await notify("Article envoyé à la racine", `Le dossier « ${folder.path} » ${reason} : l'article est à la racine.`);
    }
  } catch (error) {
    const expired = error.status === 401;
    if (expired) {
      await browser.storage.local.remove("deviceToken");
      await browser.runtime.openOptionsPage();
    }
    await badge(badgeTabId, "!", "#c62828");
    await notify("Échec de l'envoi sur reMarkable", expired ? PAIRING_EXPIRED : error.message);
  }
}
