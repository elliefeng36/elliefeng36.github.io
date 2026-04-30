import { createApp } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import { GraffitiDecentralized } from "@graffiti-garden/implementation-decentralized";
import { GraffitiPlugin } from "@graffiti-garden/wrapper-vue";
import AppLayout from "./home/index.js";
import HomeView from "./home/home-view.js";
import ChatView from "./chat/index.js";
import MeetingView from "./meeting/index.js";

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
