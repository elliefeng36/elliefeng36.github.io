import { ref, computed, provide, watch, onUnmounted } from "vue";
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
  rsvpObjectSchema,
  MEETING_RSVP_ACTIVITY,
  CHAPSTICK_MEETING_ACTIVITY,
  MEETING_ANNOUNCEMENT_ACTIVITY,
  MEETING_REMINDER_MINUTES,
} from "../meeting/shared-schemas.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DIRECTORY_CHANNEL = "chappystick-v1";
const TEAM_REMINDER_NOTIFICATION_ACTIVITY = "MeetingReminderNotification";
const TEAM_REMINDER_NOTIFICATION_TYPE = "TeamChatReminder";

function toDatetimeLocalValue(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function reminderLabel(minutes) {
  if (minutes === 60) return "1 hr";
  if (minutes === 120) return "2 hr";
  if (minutes === 1440) return "1 day";
  return `${minutes} min`;
}

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

  const teamReminderNotificationSchema = {
    properties: {
      value: {
        required: ["activity", "type", "channel", "meetingId", "published"],
        properties: {
          activity: { const: TEAM_REMINDER_NOTIFICATION_ACTIVITY },
          type: { const: TEAM_REMINDER_NOTIFICATION_TYPE },
          channel: { type: "string" },
          meetingId: { type: "string" },
          published: { type: "number" },
        },
      },
    },
  };

  const { objects: teamReminderNotifications } = useGraffitiDiscover(
    [DIRECTORY_CHANNEL],
    teamReminderNotificationSchema,
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

  const allMeetingsRows = computed(() => {
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
    return rows;
  });

  const homeMeetingsUpcoming = computed(() => {
    const now = Date.now();
    return allMeetingsRows.value
      .filter((r) => r.time >= now)
      .sort((a, b) => a.time - b.time);
  });

  const homeMeetingsPast = computed(() => {
    const now = Date.now();
    return allMeetingsRows.value
      .filter((r) => r.time < now)
      .sort((a, b) => b.time - a.time);
  });

  provide("homeMeetingsUpcoming", homeMeetingsUpcoming);
  provide("homeMeetingsPast", homeMeetingsPast);
  provide("areAllMeetingsLoading", areAllMeetingsLoading);

  const { objects: allTeamsRsvpObjects } = useGraffitiDiscover(
    () => mergedTeams.value.map((t) => t.channel),
    rsvpObjectSchema,
    session,
    true,
  );

  function latestOwnRsvp(meetingId) {
    const actor = session.value?.actor;
    if (!actor) return null;
    let best = null;
    for (const o of allTeamsRsvpObjects.value) {
      if (o.value.meetingId !== meetingId || o.actor !== actor) continue;
      if (!best || o.value.published > best.value.published) best = o;
    }
    return best;
  }

  /** True if a meeting with this id on this team channel exists and is still upcoming. */
  function meetingIsUpcomingOnChannel(teamChannel, meetingId) {
    if (!teamChannel || !meetingId) return false;
    const now = Date.now();
    for (const mo of allMeetingObjects.value) {
      if (mo.channels?.[0] !== teamChannel) continue;
      if (mo.value?.meetingId !== meetingId) continue;
      if (meetingTimeMs(mo) >= now) return true;
    }
    return false;
  }

  function userHasYesForMeeting(teamChannel, meetingId) {
    const mine = latestOwnRsvp(meetingId);
    return (
      mine?.value.response === "yes" &&
      meetingIsUpcomingOnChannel(teamChannel, meetingId)
    );
  }

  const homeMeetingRsvpBusy = ref(new Set());
  async function submitHomeMeetingRsvp(meetingId, response, teamChannel) {
    if (!teamChannel || !session.value) return;
    const key = `${meetingId}:${response}`;
    homeMeetingRsvpBusy.value.add(key);
    try {
      await graffiti.post(
        {
          value: {
            activity: MEETING_RSVP_ACTIVITY,
            meetingId,
            response,
            published: Date.now(),
          },
          channels: [teamChannel],
        },
        session.value,
      );
    } finally {
      homeMeetingRsvpBusy.value.delete(key);
    }
  }

  provide("homeLatestOwnRsvp", latestOwnRsvp);
  provide("submitHomeMeetingRsvp", submitHomeMeetingRsvp);
  provide("homeMeetingRsvpBusy", homeMeetingRsvpBusy);

  const reminderNotificationSeenPrefix = "chapstick-reminder-seen:v1:";
  const otherMeetingAnnouncementSeenPrefix = "chapstick-other-meeting-seen:v1:";
  /** Bumped when marking a team "seen" so sidebar dots refresh without waiting on Graffiti poll. */
  const teamSidebarNotificationEpoch = ref(0);

  function notificationSeenAt(channel) {
    const raw = localStorage.getItem(`${reminderNotificationSeenPrefix}${channel}`);
    const n = Number(raw ?? "0");
    return Number.isFinite(n) ? n : 0;
  }

  function otherMeetingAnnouncementSeenAt(channel) {
    const raw = localStorage.getItem(`${otherMeetingAnnouncementSeenPrefix}${channel}`);
    const n = Number(raw ?? "0");
    return Number.isFinite(n) ? n : 0;
  }

  const unreadReminderCountByChannel = computed(() => {
    void teamSidebarNotificationEpoch.value;
    const m = new Map();
    for (const o of teamReminderNotifications.value) {
      const ch = o.value?.channel;
      const meetingId = o.value?.meetingId;
      const published = o.value?.published;
      if (!ch || !meetingId || typeof published !== "number") continue;
      if (published <= notificationSeenAt(ch)) continue;
      if (!userHasYesForMeeting(ch, meetingId)) continue;
      m.set(ch, (m.get(ch) ?? 0) + 1);
    }
    return m;
  });

  function hasUnreadReminderNotification(channel) {
    return (unreadReminderCountByChannel.value.get(channel) ?? 0) > 0;
  }

  provide("hasUnreadReminderNotification", hasUnreadReminderNotification);

  const editMeetingOpen = ref(false);
  const editingMeetingObject = ref(null);
  const isSavingEdit = ref(false);
  const editMeetingName = ref("");
  const editMeetingDateTime = ref("");
  const editMeetingLocation = ref("");
  const editMeetingReminderMinutes = ref(10);

  function isMeetingAnnouncementObject(o) {
    return o.value?.activity === MEETING_ANNOUNCEMENT_ACTIVITY;
  }

  const hasUnreadOthersMeetingAnnouncementByChannel = computed(() => {
    void teamSidebarNotificationEpoch.value;
    const actor = session.value?.actor;
    const show = new Map();
    if (!actor) return show;
    for (const o of teamFeedObjects.value) {
      const ch = o.channels?.[0];
      if (!ch) continue;
      if (!isMeetingAnnouncementObject(o)) continue;
      if (o.actor === actor) continue;
      const meetingId = o.value?.meetingId;
      const pub = o.value?.published;
      if (!meetingId || typeof pub !== "number") continue;
      if (pub <= otherMeetingAnnouncementSeenAt(ch)) continue;
      if (!userHasYesForMeeting(ch, meetingId)) continue;
      show.set(ch, true);
    }
    return show;
  });

  function hasUnreadOthersMeetingAnnouncement(channel) {
    return hasUnreadOthersMeetingAnnouncementByChannel.value.get(channel) === true;
  }

  function hasUnreadTeamSidebarNotification(channel) {
    return (
      hasUnreadReminderNotification(channel) ||
      hasUnreadOthersMeetingAnnouncement(channel)
    );
  }

  provide("hasUnreadTeamSidebarNotification", hasUnreadTeamSidebarNotification);
  provide("hasUnreadOthersMeetingAnnouncement", hasUnreadOthersMeetingAnnouncement);

  function closeEditMeeting() {
    editMeetingOpen.value = false;
    editingMeetingObject.value = null;
  }

  function openEditMeeting(object) {
    if (!object?.value?.meetingId || !session.value) return;
    if (object.actor !== session.value.actor) return;
    if (object.value.activity !== CHAPSTICK_MEETING_ACTIVITY) return;
    editingMeetingObject.value = object;
    editMeetingName.value = object.value.name ?? "";
    editMeetingDateTime.value = toDatetimeLocalValue(meetingTimeMs(object));
    editMeetingLocation.value =
      object.value.location && object.value.location !== "—"
        ? object.value.location
        : "";
    editMeetingReminderMinutes.value =
      MEETING_REMINDER_MINUTES.includes(object.value.reminderMinutes)
        ? object.value.reminderMinutes
        : 10;
    editMeetingOpen.value = true;
  }

  async function saveEditedMeeting() {
    const obj = editingMeetingObject.value;
    if (!session.value || !obj?.value?.meetingId) return;
    const teamChannel = obj.channels?.[0];
    if (!teamChannel) return;
    if (!editMeetingName.value.trim() || !editMeetingDateTime.value) return;
    const meetingId = obj.value.meetingId;
    isSavingEdit.value = true;
    const name = editMeetingName.value.trim();
    const startsAt = new Date(editMeetingDateTime.value).getTime();
    const location = editMeetingLocation.value.trim() || "—";
    const reminderMinutes = Number(editMeetingReminderMinutes.value);
    const published = Date.now();
    try {
      const announcements = teamFeedObjects.value.filter(
        (o) =>
          o.channels?.[0] === teamChannel &&
          isMeetingAnnouncementObject(o) &&
          o.value.meetingId === meetingId &&
          o.actor === session.value.actor,
      );
      for (const a of announcements) {
        await graffiti.delete(a, session.value);
      }
      await graffiti.delete(obj, session.value);
      await graffiti.post(
        {
          value: {
            activity: CHAPSTICK_MEETING_ACTIVITY,
            meetingId,
            name,
            startsAt,
            location,
            reminderMinutes,
            published,
          },
          channels: [teamChannel],
        },
        session.value,
      );
      await graffiti.post(
        {
          value: {
            activity: MEETING_ANNOUNCEMENT_ACTIVITY,
            meetingId,
            name,
            startsAt,
            location,
            reminderMinutes,
            published,
          },
          channels: [teamChannel],
        },
        session.value,
      );
      closeEditMeeting();
    } finally {
      isSavingEdit.value = false;
    }
  }

  function onEditMeetingModalEscape(e) {
    if (e.key === "Escape") closeEditMeeting();
  }

  watch(editMeetingOpen, (open) => {
    if (open) {
      document.addEventListener("keydown", onEditMeetingModalEscape);
    } else {
      document.removeEventListener("keydown", onEditMeetingModalEscape);
    }
  });

  onUnmounted(() => {
    document.removeEventListener("keydown", onEditMeetingModalEscape);
  });

  provide("openEditMeeting", openEditMeeting);
  provide("closeEditMeeting", closeEditMeeting);

  const reminderTimers = new Map();
  const reminderPending = new Set();
  const reminderSentPrefix = "chapstick-reminder-sent:v1:";

  function reminderKey(o) {
    const id = o.value?.meetingId;
    const startsAt = o.value?.startsAt;
    const reminderMinutes = o.value?.reminderMinutes;
    const ch = o.channels?.[0];
    if (!id || typeof startsAt !== "number" || !ch) return "";
    return `${id}:${startsAt}:${reminderMinutes}:${ch}`;
  }

  function clearReminderTimer(key) {
    const t = reminderTimers.get(key);
    if (t) {
      clearTimeout(t);
      reminderTimers.delete(key);
    }
  }

  function latestYesRsvpActors(teamChannel, meetingId) {
    const latestByActor = new Map();
    for (const o of allTeamsRsvpObjects.value) {
      if (o.channels?.[0] !== teamChannel) continue;
      if (o.value?.meetingId !== meetingId) continue;
      const actor = o.actor;
      const prev = latestByActor.get(actor);
      if (!prev || o.value.published > prev.value.published) {
        latestByActor.set(actor, o);
      }
    }
    return [...latestByActor.values()]
      .filter((o) => o.value.response === "yes")
      .map((o) => o.actor);
  }

  async function postReminderNotifications(o, published) {
    const teamChannel = o.channels?.[0];
    const meetingId = o.value?.meetingId;
    if (!teamChannel || !meetingId || !session.value) return;
    const recipients = latestYesRsvpActors(teamChannel, meetingId);
    for (const actor of recipients) {
      try {
        await graffiti.post(
          {
            value: {
              activity: TEAM_REMINDER_NOTIFICATION_ACTIVITY,
              type: TEAM_REMINDER_NOTIFICATION_TYPE,
              channel: teamChannel,
              meetingId,
              published,
            },
            channels: [DIRECTORY_CHANNEL],
            allowed: [actor],
          },
          session.value,
        );
      } catch (e) {
        console.error("reminder notification post", e);
      }
    }
  }

  async function postMeetingReminder(o) {
    if (!session.value) return;
    const teamChannel = o.channels?.[0];
    const startsAt = o.value?.startsAt;
    const reminderMinutes = o.value?.reminderMinutes;
    if (!teamChannel || typeof startsAt !== "number") return;
    if (!MEETING_REMINDER_MINUTES.includes(reminderMinutes)) return;
    const key = reminderKey(o);
    if (!key) return;
    const storageKey = `${reminderSentPrefix}${key}`;
    if (localStorage.getItem(storageKey)) return;
    if (reminderPending.has(key)) return;
    reminderPending.add(key);
    const when = new Date(startsAt).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
    const content = `Reminder: "${o.value.name}" starts in ${reminderLabel(reminderMinutes)} (${when}) at ${o.value.location ?? "—"}.`;
    try {
      const published = Date.now();
      await graffiti.post(
        {
          value: { content, published },
          channels: [teamChannel],
        },
        session.value,
      );
      await postReminderNotifications(o, published);
      localStorage.setItem(storageKey, "1");
    } finally {
      reminderPending.delete(key);
    }
  }

  watch(
    [allMeetingObjects, () => session.value?.actor],
    ([meetings, actor]) => {
      const activeKeys = new Set();
      for (const o of meetings) {
        const startsAt = o.value?.startsAt;
        const reminderMinutes = o.value?.reminderMinutes;
        if (o.value?.activity !== CHAPSTICK_MEETING_ACTIVITY) continue;
        if (!actor || o.actor !== actor) continue;
        if (!MEETING_REMINDER_MINUTES.includes(reminderMinutes)) continue;
        if (typeof startsAt !== "number") continue;
        const fireAt = startsAt - reminderMinutes * 60 * 1000;
        const key = reminderKey(o);
        if (!key) continue;
        activeKeys.add(key);
        const storageKey = `${reminderSentPrefix}${key}`;
        if (localStorage.getItem(storageKey)) continue;
        if (Date.now() >= startsAt) continue;
        const delayMs = fireAt - Date.now();
        if (delayMs <= 0) {
          postMeetingReminder(o).catch(console.error);
          continue;
        }
        if (reminderTimers.has(key)) continue;
        const timer = setTimeout(() => {
          reminderTimers.delete(key);
          postMeetingReminder(o).catch(console.error);
        }, delayMs);
        reminderTimers.set(key, timer);
      }
      for (const key of reminderTimers.keys()) {
        if (!activeKeys.has(key)) clearReminderTimer(key);
      }
    },
    { immediate: true },
  );

  watch(activeChatId, (ch) => {
    if (!ch) return;
    const now = `${Date.now()}`;
    localStorage.setItem(`${reminderNotificationSeenPrefix}${ch}`, now);
    localStorage.setItem(`${otherMeetingAnnouncementSeenPrefix}${ch}`, now);
    teamSidebarNotificationEpoch.value += 1;
  });

  onUnmounted(() => {
    for (const key of reminderTimers.keys()) clearReminderTimer(key);
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
    editMeetingOpen,
    editMeetingName,
    editMeetingDateTime,
    editMeetingLocation,
    editMeetingReminderMinutes,
    MEETING_REMINDER_MINUTES,
    closeEditMeeting,
    saveEditedMeeting,
    isSavingEdit,
    hasUnreadTeamSidebarNotification,
  };
}

const AppLayout = { template: "#template-app", setup };

export default AppLayout;
