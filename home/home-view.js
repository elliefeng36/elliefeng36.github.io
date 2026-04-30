import { inject } from "vue";

export default {
  template: "#template-home",
  setup() {
    const allMeetingsDisplay = inject("allMeetingsDisplay");
    const areAllMeetingsLoading = inject("areAllMeetingsLoading");
    return {
      allMeetingsDisplay,
      areAllMeetingsLoading,
    };
  },
};
