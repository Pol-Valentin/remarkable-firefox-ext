import { toXhtml } from "./article.js";
import { buildEpub } from "./epub.js";
import { fetchImage } from "./images.js";
import { uploadEpub } from "./remarkable.js";

const MENU_ID = "send-to-remarkable";

browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: MENU_ID,
    title: "Envoyer la page sur reMarkable",
    contexts: ["page", "selection"],
  });
});

browser.action.onClicked.addListener((tab) => send(tab));
browser.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID) send(tab);
});

async function badge(tabId, text, color) {
  await browser.action.setBadgeBackgroundColor({ tabId, color });
  await browser.action.setBadgeText({ tabId, text });
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

async function send(tab) {
  const { deviceToken } = await browser.storage.local.get("deviceToken");
  if (!deviceToken) {
    await browser.runtime.openOptionsPage();
    return;
  }

  await badge(tab.id, "…", "#666");
  try {
    const article = await extract(tab.id);
    const { bodyXhtml, images } = await toXhtml(article.content, fetchImage);
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
    await uploadEpub(deviceToken, article.title, epub);
    await badge(tab.id, "✓", "#2e7d32");
    setTimeout(() => browser.action.setBadgeText({ tabId: tab.id, text: "" }), 4000);
  } catch (error) {
    await badge(tab.id, "!", "#c62828");
    await browser.notifications.create({
      type: "basic",
      iconUrl: browser.runtime.getURL("icons/icon.svg"),
      title: "Échec de l'envoi sur reMarkable",
      message: error.message,
    });
  }
}
