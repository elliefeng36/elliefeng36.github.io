import { createApp, ref, computed, watch } from "vue";
import { GraffitiLocal } from "@graffiti-garden/implementation-local";
import { GraffitiDecentralized } from "@graffiti-garden/implementation-decentralized";
import {
  GraffitiPlugin,
  useGraffiti,
  useGraffitiSession,
  useGraffitiDiscover,
} from "@graffiti-garden/wrapper-vue";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Team directory + join bookmarks; v1 is a new namespace (no data from `chappystick`). */
const DIRECTORY_CHANNEL = "chappystick-v1";

/** Today's date for `datetime-local` at 7:00 PM local. */
function defaultMeetingDatetimeLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T19:00`;
}

function setup() {
  const graffiti = useGraffiti();
  const session = useGraffitiSession();

  const channel = ref("");

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
      // Public on the team channel so joiners (who have the id) can resolve the display name.
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
      channel.value = teamId;
    } finally {
      isCreating.value = false;
    }
  }

  function changeChat(teamChannel) {
    channel.value = teamChannel;
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

  const { objects: chats } = useGraffitiDiscover(
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

  const { objects: joinedBookmarks } = useGraffitiDiscover(
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
    return [...byChannel.values()];
  });

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
      channel.value = code;
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
      if (channel.value === teamChannel) channel.value = "";
    }
  }

  const myMessage = ref("");

  const messageSchema = {
    properties: {
      value: {
        required: ["content", "published"],
        properties: {
          content: { type: "string" },
          published: { type: "number" },
        },
      },
    },
  };

  const { objects: messageObjects, isFirstPoll: areMessageObjectsLoading } =
    useGraffitiDiscover(
      () => (channel.value ? [channel.value] : []),
      messageSchema,
      session,
      true,
    );

  const sortedMessageObjects = computed(() => {
    return messageObjects.value.toSorted((a, b) => {
      return b.value.published - a.value.published;
    });
  });

  const meetingName = ref("");
  const meetingDateTime = ref("");
  const meetingLocation = ref("");
  const isScheduling = ref(false);

  const meetingSchema = {
    properties: {
      value: {
        required: ["name", "published"],
        properties: {
          name: { type: "string" },
          published: { type: "number" },
          startsAt: { type: "number" },
          location: { type: "string" },
          date: { type: "number" },
        },
      },
    },
  };

  const { objects: meetingObjects, isFirstPoll: areMeetingObjectsLoading } =
    useGraffitiDiscover(
      () => (channel.value ? [channel.value] : []),
      meetingSchema,
      session,
      true,
    );

  function meetingTimeMs(o) {
    const v = o.value;
    if (typeof v.startsAt === "number") return v.startsAt;
    if (typeof v.date === "number") return v.date;
    if (typeof v.published === "number") return v.published;
    return 0;
  }

  function isMeetingPast(o) {
    return meetingTimeMs(o) < Date.now();
  }

  const sortedMeetingObjects = computed(() => {
    const list = meetingObjects.value.slice();
    const now = Date.now();
    const upcoming = list.filter((o) => meetingTimeMs(o) >= now);
    const past = list.filter((o) => meetingTimeMs(o) < now);
    upcoming.sort((a, b) => meetingTimeMs(a) - meetingTimeMs(b));
    past.sort((a, b) => meetingTimeMs(b) - meetingTimeMs(a));
    return [...upcoming, ...past];
  });

  const isSending = ref(false);
  async function sendMessage() {
    if (!channel.value) return;
    isSending.value = true;
    try {
      // Public on the team channel so new members see full history (join code = channel id).
      await graffiti.post(
        {
          value: {
            content: myMessage.value,
            published: Date.now(),
          },
          channels: [channel.value],
        },
        session.value,
      );
      myMessage.value = "";
    } finally {
      isSending.value = false;
    }
  }

  const isDeleting = ref(new Set());
  async function deleteMessage(message) {
    isDeleting.value.add(message.url);
    try {
      await graffiti.delete(message, session.value);
    } finally {
      isDeleting.value.delete(message.url);
    }
  }

  async function schedMeeting() {
    if (!channel.value || !meetingDateTime.value) return;
    isScheduling.value = true;
    const startsAt = new Date(meetingDateTime.value).getTime();
    const location = meetingLocation.value.trim() || "—";
    try {
      await graffiti.post(
        {
          value: {
            name: meetingName.value.trim(),
            startsAt,
            location,
            published: Date.now(),
          },
          channels: [channel.value],
        },
        session.value,
      );
      meetingName.value = "";
      meetingDateTime.value = defaultMeetingDatetimeLocal();
      meetingLocation.value = "";
    } finally {
      isScheduling.value = false;
    }
  }

  const currentTeamTitle = computed(() => {
    const t = mergedTeams.value.find((x) => x.channel === channel.value);
    return t?.title ?? "";
  });

  const teamCodeJustCopied = ref(false);
  let teamCodeCopyTimer = 0;
  async function copyTeamCode() {
    if (!channel.value) return;
    try {
      await navigator.clipboard.writeText(channel.value);
      teamCodeJustCopied.value = true;
      clearTimeout(teamCodeCopyTimer);
      teamCodeCopyTimer = setTimeout(() => {
        teamCodeJustCopied.value = false;
      }, 2000);
    } catch (e) {
      console.error(e);
      teamCodeJustCopied.value = false;
    }
  }

  watch(channel, (ch) => {
    teamCodeJustCopied.value = false;
    clearTimeout(teamCodeCopyTimer);
    if (ch) {
      meetingDateTime.value = defaultMeetingDatetimeLocal();
    } else {
      meetingDateTime.value = "";
    }
  });

  return {
    myMessage,
    messageObjects,
    areMessageObjectsLoading,
    sortedMessageObjects,
    isSending,
    sendMessage,
    isDeleting,
    deleteMessage,
    newChat,
    chats,
    mergedTeams,
    changeChat,
    channel,
    newChatName,
    isCreating,
    teamCode,
    isJoining,
    joinTeam,
    joinError,
    meetingName,
    meetingDateTime,
    meetingLocation,
    isScheduling,
    schedMeeting,
    sortedMeetingObjects,
    areMeetingObjectsLoading,
    isMeetingPast,
    currentTeamTitle,
    copyTeamCode,
    teamCodeJustCopied,
    leaveTeam,
    leavingTeamChannel,
  };
}

const App = { template: "#template", setup };

createApp(App)
  .use(GraffitiPlugin, {
    // graffiti: new GraffitiLocal(),
    graffiti: new GraffitiDecentralized(),
  })
  .mount("#app");
