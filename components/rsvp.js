export default {
  template: "#template-rsvp-buttons",
  props: {
    yourResponse: { default: null },
    busyYes: { type: Boolean, default: false },
    busyNo: { type: Boolean, default: false },
    /** Shorter labels (e.g. meeting bar in chat header). */
    compact: { type: Boolean, default: false },
  },
  emits: ["yes", "no"],
};
