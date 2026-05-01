import { createApp } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import { GraffitiDecentralized } from "@graffiti-garden/implementation-decentralized";
import { GraffitiPlugin } from "@graffiti-garden/wrapper-vue";
import AppLayout from "./home/index.js";
import HomeView from "./home/home-view.js";
import ChatView from "./chat/index.js";
import MeetingView from "./meeting/index.js";

/** Append `<template id="...">` from a small HTML document (same origin). */
async function appendTemplateFromHtml(url, templateId) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load ${url}: ${res.status}`);
  }
  const doc = new DOMParser().parseFromString(await res.text(), "text/html");
  const el = doc.getElementById(templateId);
  if (!el || el.tagName !== "TEMPLATE") {
    throw new Error(`Expected <template id="${templateId}"> in ${url}`);
  }
  document.body.appendChild(el);
}

await Promise.all([
  appendTemplateFromHtml("/home/index.html", "template-home"),
  appendTemplateFromHtml("/chat/index.html", "template-chat"),
  appendTemplateFromHtml("/meeting/index.html", "template-meeting"),
  appendTemplateFromHtml("/components/rsvp.html", "template-rsvp-buttons"),
]);

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      component: AppLayout,
      children: [
        { path: "", name: "home", component: HomeView },
        { path: "chat/:chatID", name: "chat", component: ChatView },
        { path: "meeting/:meetingID", name: "meeting", component: MeetingView },
      ],
    },
  ],
});

createApp({ template: "<router-view />" })
  .use(GraffitiPlugin, { graffiti: new GraffitiDecentralized() })
  .use(router)
  .mount("#app");
