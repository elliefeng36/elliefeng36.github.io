import { ref, computed, provide } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  useGraffiti,
  useGraffitiSession,
  useGraffitiDiscover,
} from "@graffiti-garden/wrapper-vue";
import {
  meetingObjectSchema,
  meetingTimeMs,
  chatFeedObjectSchema,
} from "../meeting/shared-schemas.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DIRECTORY_CHANNEL = "chappystick-v1";

function setup() {
  const graffiti = useGraffiti();
  const session = useGraffitiSession();
  const route = useRoute();
  const router = useRouter();

  const activeChatId = computed(() => {
    const id = route.params.chatID;
    if (typeof id !== "string" || !UUID_RE.test(id)) return "";
    return id;
  });

  const newChatName = ref("");
  const isCreating = ref(false);

  async function newChat() {
    isCreating.value = true;
    const teamId = crypto.randomUUID();
    const actor = session.value.actor;
    const title = newChatName.value;
    try {
      await graffiti.post(
        {
          value: {
            activity: "Create",
            type: "Chat",
            channel: teamId,
            title,
            published: Date.now(),
          },
          channels: [DIRECTORY_CHANNEL],
          allowed: [actor],
        },
        session.value,
      );
      await graffiti.post(
        {
          value: {
            activity: "MemberPresence",
            type: "Presence",
            published: Date.now(),
          },
          channels: [teamId],
        },
        session.value,
      );
      await graffiti.post(
        {
          value: {
            activity: "TeamMeta",
            type: "Title",
            title,
            published: Date.now(),
          },
          channels: [teamId],
        },
        session.value,
      );
      newChatName.value = "";
      await router.push({ name: "chat", params: { chatID: teamId } });
    } finally {
      isCreating.value = false;
    }
  }

  const chatDirectorySchema = {
    properties: {
      value: {
        required: ["activity", "type", "channel", "title", "published"],
        properties: {
          activity: { const: "Create" },
          type: { const: "Chat" },
          channel: { type: "string" },
          title: { type: "string" },
          published: { type: "number" },
        },
      },
    },
  };

  const { objects: chats, isFirstPoll: chatsFirstPoll } = useGraffitiDiscover(
    [DIRECTORY_CHANNEL],
    chatDirectorySchema,
    session,
    true,
  );

  const joinBookmarkSchema = {
    properties: {
      value: {
        required: ["activity", "type", "channel", "published"],
        properties: {
          activity: { const: "Join" },
          type: { const: "ChatBookmark" },
          channel: { type: "string" },
          title: { type: "string" },
          published: { type: "number" },
        },
      },
    },
  };

  const { objects: joinedBookmarks, isFirstPoll: bookmarksFirstPoll } =
    useGraffitiDiscover(
      [DIRECTORY_CHANNEL],
      joinBookmarkSchema,
      session,
      true,
    );

  const bookmarkChannelIds = computed(() => [
    ...new Set(joinedBookmarks.value.map((o) => o.value.channel)),
  ]);

  const teamMetaSchema = {
    properties: {
      value: {
        required: ["activity", "type", "title", "published"],
        properties: {
          activity: { const: "TeamMeta" },
          type: { const: "Title" },
          title: { type: "string" },
          published: { type: "number" },
        },
      },
    },
  };

  const { objects: teamMetaObjects } = useGraffitiDiscover(
    () => bookmarkChannelIds.value,
    teamMetaSchema,
    session,
    true,
  );

  /** All team channel ids (created or bookmarked) for feed activity. */
  const teamChannelsForActivity = computed(() => {
    const ids = new Set();
    for (const o of chats.value) ids.add(o.value.channel);
    for (const o of joinedBookmarks.value) ids.add(o.value.channel);
    return [...ids];
  });

  const { objects: teamFeedObjects } = useGraffitiDiscover(
    () => teamChannelsForActivity.value,
    chatFeedObjectSchema,
    session,
    true,
  );

  /** Latest message `published` time per team channel (chat + announcements). */
  const lastMessageTimeByChannel = computed(() => {
    const m = new Map();
    for (const o of teamFeedObjects.value) {
      const ch = o.channels?.[0];
      if (!ch) continue;
      const t = o.value?.published;
      if (typeof t !== "number") continue;
      const prev = m.get(ch) ?? 0;
      if (t > prev) m.set(ch, t);
    }
    return m;
  });

  /** True while the directory / join-bookmark discovers have not finished their first poll yet. */
  const teamsListLoading = computed(
    () => chatsFirstPoll.value || bookmarksFirstPoll.value,
  );

  const mergedTeams = computed(() => {
    const metaTitleByChannel = new Map();
    for (const o of teamMetaObjects.value) {
      const ch = o.channels?.[0];
      if (!ch) continue;
      const pub = o.value.published;
      const prev = metaTitleByChannel.get(ch);
      if (!prev || pub > prev.published) {
        metaTitleByChannel.set(ch, {
          title: o.value.title,
          published: pub,
        });
      }
    }

    const byChannel = new Map();
    for (const o of chats.value) {
      byChannel.set(o.value.channel, {
        channel: o.value.channel,
        title: o.value.title,
      });
    }
    for (const o of joinedBookmarks.value) {
      const ch = o.value.channel;
      if (!byChannel.has(ch)) {
        const fromMeta = metaTitleByChannel.get(ch)?.title;
        byChannel.set(ch, {
          channel: ch,
          title:
            fromMeta ||
            o.value.title ||
            `Team (${ch.slice(0, 8)}…)`,
        });
      }
    }

    const lastMsg = lastMessageTimeByChannel.value;

    const rows = [...byChannel.values()].map((row) => {
      const ch = row.channel;
      let joinOrCreateTs = 0;
      for (const o of joinedBookmarks.value) {
        if (o.value.channel === ch) {
          joinOrCreateTs = Math.max(joinOrCreateTs, o.value.published);
        }
      }
      for (const o of chats.value) {
        if (o.value.channel === ch) {
          joinOrCreateTs = Math.max(joinOrCreateTs, o.value.published);
        }
      }
      const msgTs = lastMsg.get(ch) ?? 0;
      const sortKey = Math.max(joinOrCreateTs, msgTs);
      return { ...row, sortKey };
    });

    rows.sort((a, b) => b.sortKey - a.sortKey);
    return rows.map(({ sortKey, ...rest }) => rest);
  });

  provide("mergedTeams", mergedTeams);

  const { objects: allMeetingObjects, isFirstPoll: areAllMeetingsLoading } =
    useGraffitiDiscover(
      () => mergedTeams.value.map((t) => t.channel),
      meetingObjectSchema,
      session,
      true,
    );

  const allMeetingsDisplay = computed(() => {
    const rows = [];
    for (const o of allMeetingObjects.value) {
      const teamChannel = o.channels?.[0];
      const teamTitle =
        mergedTeams.value.find((t) => t.channel === teamChannel)?.title ??
        "Team";
      rows.push({
        object: o,
        teamChannel,
        teamTitle,
        time: meetingTimeMs(o),
      });
    }
    rows.sort((a, b) => a.time - b.time);
    return rows;
  });

  provide("allMeetingsDisplay", allMeetingsDisplay);
  provide("areAllMeetingsLoading", areAllMeetingsLoading);

  const teamCode = ref("");
  const isJoining = ref(false);
  const joinError = ref("");

  async function joinTeam() {
    joinError.value = "";
    const code = teamCode.value.trim();
    if (!UUID_RE.test(code)) {
      joinError.value = "Join code must be a valid team id (UUID).";
      return;
    }
    isJoining.value = true;
    const actor = session.value.actor;
    try {
      await graffiti.post(
        {
          value: {
            activity: "Join",
            type: "ChatBookmark",
            channel: code,
            published: Date.now(),
          },
          channels: [DIRECTORY_CHANNEL],
          allowed: [actor],
        },
        session.value,
      );
      await graffiti.post(
        {
          value: {
            activity: "MemberPresence",
            type: "Presence",
            published: Date.now(),
          },
          channels: [code],
        },
        session.value,
      );
      teamCode.value = "";
      await router.push({ name: "chat", params: { chatID: code } });
    } catch (e) {
      joinError.value = "Could not join that team.";
      console.error(e);
    } finally {
      isJoining.value = false;
    }
  }

  const presenceLeaveSchema = {
    properties: {
      value: {
        required: ["activity", "type", "published"],
        properties: {
          activity: { const: "MemberPresence" },
          type: { const: "Presence" },
          published: { type: "number" },
        },
      },
    },
  };

  async function drainDiscoverLeave(channels, schema) {
    if (!session.value?.actor || !channels?.length) return [];
    const list = [];
    try {
      const stream = graffiti.discover(channels, schema, session.value);
      for await (const ev of stream) {
        if (ev?.error) continue;
        if (ev?.tombstone) continue;
        if (ev?.object) list.push(ev.object);
      }
    } catch (e) {
      console.error("discover leave", e);
    }
    return list;
  }

  async function deleteMineMatching(list, pred) {
    const actor = session.value?.actor;
    if (!actor) return;
    for (const o of list) {
      if (o.actor !== actor) continue;
      if (pred && !pred(o)) continue;
      try {
        await graffiti.delete(o, session.value);
      } catch (e) {
        console.error("leave delete", o.url, e);
      }
    }
  }

  const leavingTeamChannel = ref(null);

  async function leaveTeam(teamChannel) {
    if (!teamChannel || !session.value?.actor) return;
    if (
      !confirm(
        "Leave this team? It disappears from your list; you can rejoin with the join code. Messages you sent stay in the channel.",
      )
    ) {
      return;
    }
    leavingTeamChannel.value = teamChannel;
    try {
      const dirBookmarks = await drainDiscoverLeave(
        [DIRECTORY_CHANNEL],
        joinBookmarkSchema,
      );
      await deleteMineMatching(
        dirBookmarks,
        (o) => o.value.channel === teamChannel,
      );

      const dirCreates = await drainDiscoverLeave(
        [DIRECTORY_CHANNEL],
        chatDirectorySchema,
      );
      await deleteMineMatching(
        dirCreates,
        (o) => o.value.channel === teamChannel,
      );

      const presences = await drainDiscoverLeave(
        [teamChannel],
        presenceLeaveSchema,
      );
      await deleteMineMatching(presences, null);

      const metas = await drainDiscoverLeave([teamChannel], teamMetaSchema);
      await deleteMineMatching(metas, null);
    } finally {
      leavingTeamChannel.value = null;
      if (activeChatId.value === teamChannel) {
        await router.push({ name: "home" });
      }
    }
  }

  return {
    newChat,
    mergedTeams,
    teamsListLoading,
    activeChatId,
    newChatName,
    isCreating,
    teamCode,
    isJoining,
    joinTeam,
    joinError,
    leaveTeam,
    leavingTeamChannel,
  };
}

const AppLayout = { template: "#template-app", setup };

export default AppLayout;
