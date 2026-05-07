import { computed, inject } from "vue";
import { useGraffitiSession } from "@graffiti-garden/wrapper-vue";
import { CHAPSTICK_MEETING_ACTIVITY } from "../../meeting/shared-schemas.js";

export default {
  template: "#template-edit-meeting-button",
  props: {
    /** Canonical Chappystick meeting Graffiti object (same shape as discover). */
    meetingObject: { type: Object, default: null },
  },
  emits: ["before-edit"],
  setup(props, { emit }) {
    const session = useGraffitiSession();
    const openEditMeeting = inject("openEditMeeting", () => {});

    const canEdit = computed(() => {
      const o = props.meetingObject;
      const actor = session.value?.actor;
      if (!o?.value?.meetingId || !actor) return false;
      if (o.value.activity !== CHAPSTICK_MEETING_ACTIVITY) return false;
      if (o.actor !== actor) return false;
      return true;
    });

    function onClick() {
      emit("before-edit");
      if (props.meetingObject) openEditMeeting(props.meetingObject);
    }

    return { canEdit, onClick };
  },
};
