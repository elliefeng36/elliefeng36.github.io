import { inject } from "vue";
import RsvpButtons from "../components/rsvp.js";

export default {
  template: "#template-home",
  components: { RsvpButtons },
  setup() {
    const allMeetingsDisplay = inject("allMeetingsDisplay");
    const areAllMeetingsLoading = inject("areAllMeetingsLoading");
    const homeLatestOwnRsvp = inject("homeLatestOwnRsvp");
    const submitHomeMeetingRsvp = inject("submitHomeMeetingRsvp");
    const homeMeetingRsvpBusy = inject("homeMeetingRsvpBusy");
    return {
      allMeetingsDisplay,
      areAllMeetingsLoading,
      homeLatestOwnRsvp,
      submitHomeMeetingRsvp,
      homeMeetingRsvpBusy,
    };
  },
};
