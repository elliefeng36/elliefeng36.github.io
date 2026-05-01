import { computed, inject, watch, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  useGraffiti,
  useGraffitiSession,
  useGraffitiDiscover,
} from "@graffiti-garden/wrapper-vue";
import {
  meetingObjectSchema,
  rsvpObjectSchema,
  meetingTimeMs,
  MEETING_RSVP_ACTIVITY,
} from "./shared-schemas.js";
import RsvpButtons from "../components/rsvp.js";
import ActorDisplay from "../components/actor-display.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function setup() {
  const route = useRoute();
  const router = useRouter();
  const graffiti = useGraffiti();
  const session = useGraffitiSession();
  const mergedTeams = inject("mergedTeams");

  const teamChannelIds = computed(() =>
    mergedTeams.value.map((t) => t.channel),
  );

  const { objects: meetingPool, isFirstPoll: meetingsLoading } =
    useGraffitiDiscover(
      () => teamChannelIds.value,
      meetingObjectSchema,
      session,
      true,
    );

  const meetingIdParam = computed(() =>
    typeof route.params.meetingID === "string" ? route.params.meetingID : "",
  );

  watch(
    meetingIdParam,
    (id) => {
      if (id && !UUID_RE.test(id)) {
        router.replace({ name: "home" });
      }
    },
    { immediate: true },
  );

  const meetingObject = computed(() => {
    const id = meetingIdParam.value;
    if (!id || !UUID_RE.test(id)) return null;
    return meetingPool.value.find((o) => o.value.meetingId === id) ?? null;
  });

  const meetingChannel = computed(
    () => meetingObject.value?.channels?.[0] ?? "",
  );

  const { objects: rsvpObjects, isFirstPoll: rsvpsLoading } = useGraffitiDiscover(
    () => (meetingChannel.value ? [meetingChannel.value] : []),
    rsvpObjectSchema,
    session,
    true,
  );

  const rsvpRows = computed(() => {
    const id = meetingIdParam.value;
    if (!id) return [];
    const byActor = new Map();
    for (const o of rsvpObjects.value) {
      if (o.value.meetingId !== id) continue;
      const prev = byActor.get(o.actor);
      if (!prev || o.value.published > prev.value.published) {
        byActor.set(o.actor, o);
      }
    }
    return [...byActor.values()].sort(
      (a, b) => b.value.published - a.value.published,
    );
  });

  const yesCount = computed(
    () => rsvpRows.value.filter((o) => o.value.response === "yes").length,
  );
  const noCount = computed(
    () => rsvpRows.value.filter((o) => o.value.response === "no").length,
  );

  const teamTitle = computed(() => {
    const ch = meetingChannel.value;
    if (!ch) return "";
    return mergedTeams.value.find((t) => t.channel === ch)?.title ?? "Team";
  });

  const notFound = computed(() => {
    if (!meetingIdParam.value || !UUID_RE.test(meetingIdParam.value)) {
      return false;
    }
    if (meetingsLoading.value) return false;
    return !meetingObject.value;
  });

  const ownRsvpResponse = computed(() => {
    const actor = session.value?.actor;
    if (!actor) return null;
    const mine = rsvpRows.value.find((o) => o.actor === actor);
    return mine?.value.response ?? null;
  });

  const rsvpSubmitting = ref(null);

  async function postRsvp(response) {
    const id = meetingIdParam.value;
    const ch = meetingChannel.value;
    if (!meetingObject.value || !id || !ch || !session.value) return;
    rsvpSubmitting.value = response;
    try {
      await graffiti.post(
        {
          value: {
            activity: MEETING_RSVP_ACTIVITY,
            meetingId: id,
            response,
            published: Date.now(),
          },
          channels: [ch],
        },
        session.value,
      );
    } finally {
      rsvpSubmitting.value = null;
    }
  }

  return {
    meetingObject,
    meetingIdParam,
    meetingTimeMs,
    rsvpRows,
    yesCount,
    noCount,
    meetingsLoading,
    rsvpsLoading,
    teamTitle,
    meetingChannel,
    notFound,
    postRsvp,
    ownRsvpResponse,
    rsvpSubmitting,
  };
}

export default {
  template: "#template-meeting",
  components: { RsvpButtons, ActorDisplay },
  setup,
};
