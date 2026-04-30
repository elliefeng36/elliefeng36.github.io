/** Graffiti object schemas: `properties.value` shapes (whole-object wrapper). */

export const CHAPSTICK_MEETING_ACTIVITY = "ChappystickMeeting";
export const MEETING_ANNOUNCEMENT_ACTIVITY = "MeetingAnnouncement";
export const MEETING_RSVP_ACTIVITY = "MeetingRsvp";

/** Legacy meetings (no activity key). */
const legacyMeetingValue = {
  type: "object",
  additionalProperties: false,
  required: ["name", "published"],
  properties: {
    name: { type: "string" },
    published: { type: "number" },
    startsAt: { type: "number" },
    location: { type: "string" },
    date: { type: "number" },
  },
};

/** New meetings with stable `meetingId` for routing + RSVPs. */
const newMeetingValue = {
  type: "object",
  additionalProperties: false,
  required: [
    "activity",
    "meetingId",
    "name",
    "published",
    "startsAt",
    "location",
  ],
  properties: {
    activity: { const: CHAPSTICK_MEETING_ACTIVITY },
    meetingId: { type: "string" },
    name: { type: "string" },
    published: { type: "number" },
    startsAt: { type: "number" },
    location: { type: "string" },
  },
};

export const meetingObjectSchema = {
  properties: {
    value: {
      oneOf: [legacyMeetingValue, newMeetingValue],
    },
  },
};

/** Chat feed: plain text or meeting announcement (RSVPs use separate discover). */
const chatTextValue = {
  type: "object",
  additionalProperties: false,
  required: ["content", "published"],
  properties: {
    content: { type: "string" },
    published: { type: "number" },
  },
};

const chatAnnouncementValue = {
  type: "object",
  additionalProperties: false,
  required: [
    "activity",
    "meetingId",
    "name",
    "startsAt",
    "published",
    "location",
  ],
  properties: {
    activity: { const: MEETING_ANNOUNCEMENT_ACTIVITY },
    meetingId: { type: "string" },
    name: { type: "string" },
    startsAt: { type: "number" },
    published: { type: "number" },
    location: { type: "string" },
  },
};

export const chatFeedObjectSchema = {
  properties: {
    value: {
      oneOf: [chatTextValue, chatAnnouncementValue],
    },
  },
};

export const rsvpObjectSchema = {
  properties: {
    value: {
      type: "object",
      additionalProperties: false,
      required: ["activity", "meetingId", "response", "published"],
      properties: {
        activity: { const: MEETING_RSVP_ACTIVITY },
        meetingId: { type: "string" },
        response: { enum: ["yes", "no"] },
        published: { type: "number" },
      },
    },
  },
};

export function meetingTimeMs(o) {
  const v = o.value;
  if (typeof v.startsAt === "number") return v.startsAt;
  if (typeof v.date === "number") return v.date;
  if (typeof v.published === "number") return v.published;
  return 0;
}

export function meetingStableId(o) {
  return o.value.meetingId ?? o.url;
}
