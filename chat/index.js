import { ref, computed, watch, inject } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  useGraffiti,
  useGraffitiSession,
  useGraffitiDiscover,
} from "@graffiti-garden/wrapper-vue";
import {
  meetingObjectSchema,
  chatFeedObjectSchema,
  rsvpObjectSchema,
  meetingTimeMs,
  CHAPSTICK_MEETING_ACTIVITY,
  MEETING_ANNOUNCEMENT_ACTIVITY,
  MEETING_RSVP_ACTIVITY,
} from "../meeting/shared-schemas.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function defaultMeetingDatetimeLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T19:00`;
}

function isAnnouncementObject(o) {
  return o.value?.activity === MEETING_ANNOUNCEMENT_ACTIVITY;
}

function setup() {
  const graffiti = useGraffiti();
  const session = useGraffitiSession();
  const route = useRoute();
  const router = useRouter();
  const mergedTeams = inject("mergedTeams");

  const channel = computed(() => {
    const id = route.params.chatID;
    if (typeof id !== "string" || !UUID_RE.test(id)) return "";
    return id;
  });

  watch(
    () => route.params.chatID,
    (id) => {
      if (typeof id === "string" && id.length > 0 && !UUID_RE.test(id)) {
        router.replace({ name: "home" });
      }
    },
    { immediate: true },
  );

  const myMessage = ref("");

  const { objects: feedObjects, isFirstPoll: areMessageObjectsLoading } =
    useGraffitiDiscover(
      () => (channel.value ? [channel.value] : []),
      chatFeedObjectSchema,
      session,
      true,
    );

  const sortedFeedObjects = computed(() => {
    return feedObjects.value.toSorted((a, b) => {
      return b.value.published - a.value.published;
    });
  });

  const { objects: rsvpObjects } = useGraffitiDiscover(
    () => (channel.value ? [channel.value] : []),
    rsvpObjectSchema,
    session,
    true,
  );

  function latestOwnRsvp(meetingId) {
    const actor = session.value?.actor;
    if (!actor) return null;
    let best = null;
    for (const o of rsvpObjects.value) {
      if (o.value.meetingId !== meetingId || o.actor !== actor) continue;
      if (!best || o.value.published > best.value.published) best = o;
    }
    return best;
  }

  const rsvpBusy = ref(new Set());
  async function submitRsvp(meetingId, response) {
    if (!channel.value || !session.value) return;
    const key = `${meetingId}:${response}`;
    rsvpBusy.value.add(key);
    try {
      await graffiti.post(
        {
          value: {
            activity: MEETING_RSVP_ACTIVITY,
            meetingId,
            response,
            published: Date.now(),
          },
          channels: [channel.value],
        },
        session.value,
      );
    } finally {
      rsvpBusy.value.delete(key);
    }
  }

  const meetingName = ref("");
  const meetingDateTime = ref("");
  const meetingLocation = ref("");
  const isScheduling = ref(false);

  const { objects: meetingObjects, isFirstPoll: areMeetingObjectsLoading } =
    useGraffitiDiscover(
      () => (channel.value ? [channel.value] : []),
      meetingObjectSchema,
      session,
      true,
    );

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
    const name = meetingName.value.trim();
    const meetingId = crypto.randomUUID();
    const published = Date.now();
    try {
      await graffiti.post(
        {
          value: {
            activity: CHAPSTICK_MEETING_ACTIVITY,
            meetingId,
            name,
            startsAt,
            location,
            published,
          },
          channels: [channel.value],
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
            published,
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
    areMessageObjectsLoading,
    sortedFeedObjects,
    isAnnouncementObject,
    isSending,
    sendMessage,
    isDeleting,
    deleteMessage,
    meetingName,
    meetingDateTime,
    meetingLocation,
    isScheduling,
    schedMeeting,
    sortedMeetingObjects,
    areMeetingObjectsLoading,
    isMeetingPast,
    meetingTimeMs,
    currentTeamTitle,
    channel,
    copyTeamCode,
    teamCodeJustCopied,
    latestOwnRsvp,
    submitRsvp,
    rsvpBusy,
  };
}

export default {
  template: "#template-chat",
  setup,
};
