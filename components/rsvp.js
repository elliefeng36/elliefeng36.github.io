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
  data() {
    return { jumpYes: false, jumpNo: false };
  },
  methods: {
    playJumpYes() {
      this.jumpYes = false;
      this.$nextTick(() => {
        this.jumpYes = true;
      });
    },
    playJumpNo() {
      this.jumpNo = false;
      this.$nextTick(() => {
        this.jumpNo = true;
      });
    },
    onYes() {
      this.playJumpYes();
      this.$emit("yes");
    },
    onNo() {
      this.playJumpNo();
      this.$emit("no");
    },
  },
};
