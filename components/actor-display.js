import {
  ref,
  watch,
  onMounted,
  onBeforeUnmount,
  nextTick,
} from "vue";

const SUFFIX = ".graffiti.actor";

function stripGraffitiSuffix(text) {
  if (text == null) return "";
  const s = String(text).trim();
  if (s.endsWith(SUFFIX)) {
    return s.slice(0, -SUFFIX.length) || s;
  }
  return s;
}

/**
 * Renders Graffiti’s resolved handle via graffiti-actor-to-handle (off-screen),
 * then shows the same label with a trailing *.graffiti.actor removed (e.g. "alice").
 */
export default {
  name: "ActorDisplay",
  props: {
    actor: { default: null },
  },
  setup(props) {
    const display = ref("—");
    const probeRef = ref(null);
    let observer = null;

    function syncFromProbe() {
      const root = probeRef.value;
      if (!root) return;
      const raw = root.textContent?.trim() ?? "";
      const next = stripGraffitiSuffix(raw);
      display.value = next || raw || "—";
    }

    function attachObserver() {
      observer?.disconnect();
      const el = probeRef.value;
      if (!el) return;
      observer = new MutationObserver(() => {
        nextTick(syncFromProbe);
      });
      observer.observe(el, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }

    watch(
      () => props.actor,
      async () => {
        await nextTick();
        syncFromProbe();
      },
      { immediate: true },
    );

    onMounted(async () => {
      await nextTick();
      attachObserver();
      syncFromProbe();
    });

    onBeforeUnmount(() => {
      observer?.disconnect();
      observer = null;
    });

    return { display, probeRef };
  },
  template: `
    <span class="actor-display">
      <span class="actor-display-text">{{ display }}</span>
      <span
        ref="probeRef"
        class="actor-display-probe"
        aria-hidden="true"
      >
        <graffiti-actor-to-handle :actor="actor"></graffiti-actor-to-handle>
      </span>
    </span>
  `,
};
