import { toXhtml } from "./article.js";
import { buildEpub } from "./epub.js";
import { fetchImage } from "./images.js";
import { resolveParent } from "./folders.js";
import { uploadEpub, userToken } from "./remarkable.js";

const ALL_SITES = { origins: ["<all_urls>"] };
const PAIRING_EXPIRED = "L'appairage a expiré : saisis un nouveau code dans les options.";

browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: "send-to-remarkable",
    title: "Envoyer la page sur reMarkable",
    contexts: ["page", "selection"],
  });
});

browser.action.onClicked.addListener((tab) => send(tab));
browser.contextMenus.onClicked.addListener((_, tab) => send(tab));

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

export async function send(tab) {
  const { deviceToken, folder } = await browser.storage.local.get(["deviceToken", "folder"]);
  if (!deviceToken || !(await browser.permissions.contains(ALL_SITES))) {
    await browser.runtime.openOptionsPage();
    return;
  }

  await badge(tab.id, "…", "#666");
  const token = userToken(deviceToken);
  const parent = token.then((t) => resolveParent(t, folder));
  token.catch(() => {});
  parent.catch(() => {});
  try {
    const article = await extract(tab.id);
    const { bodyXhtml, images } = await toXhtml(article.content, (url) => fetchImage(url, (src) => fetchFromPage(tab.id, src)));
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
    await uploadEpub(await token, article.title, epub, destination);
    await badge(tab.id, "✓", "#2e7d32");
    setTimeout(() => browser.action.setBadgeText({ tabId: tab.id, text: "" }), 4000);
    if (folder && !destination) {
      await notify("Article envoyé à la racine", `Le dossier « ${folder.path} » n'existe plus : l'article est à la racine.`);
    }
  } catch (error) {
    const expired = error.status === 401;
    if (expired) {
      await browser.storage.local.remove("deviceToken");
      await browser.runtime.openOptionsPage();
    }
    await badge(tab.id, "!", "#c62828");
    await notify("Échec de l'envoi sur reMarkable", expired ? PAIRING_EXPIRED : error.message);
  }
}
