import { inject } from "vue";
import RsvpButtons from "../components/rsvp.js";
import EditMeetingButton from "../components/edit-meeting-button/edit-meeting-button.js";

export default {
  template: "#template-home",
  components: { RsvpButtons, EditMeetingButton },
  setup() {
    const homeMeetingsUpcoming = inject("homeMeetingsUpcoming");
    const homeMeetingsPast = inject("homeMeetingsPast");
    const areAllMeetingsLoading = inject("areAllMeetingsLoading");
    const homeLatestOwnRsvp = inject("homeLatestOwnRsvp");
    const submitHomeMeetingRsvp = inject("submitHomeMeetingRsvp");
    const homeMeetingRsvpBusy = inject("homeMeetingRsvpBusy");
    const hasUnreadReminderNotification = inject("hasUnreadReminderNotification");
    return {
      homeMeetingsUpcoming,
      homeMeetingsPast,
      areAllMeetingsLoading,
      homeLatestOwnRsvp,
      submitHomeMeetingRsvp,
      homeMeetingRsvpBusy,
      hasUnreadReminderNotification,
    };
  },
};
