import type { LocaleCopy } from "./types.js";

export const en: LocaleCopy = {
  greeting: (name) => (name ? `Hi ${name},` : "Hi there,"),
  labels: { when: "When", services: "Services", where: "Where", phone: "Questions? Call", with: "with" },
  keys: {
    "appointment.confirmed": {
      subject: (c) => `Your appointment at ${c.salonName} is booked`,
      headline: (c, w) => `Your appointment at ${c.salonName} is booked for ${w}.`,
      pushTitle: (c) => `Booked at ${c.salonName}`,
      linkLabel: "Confirm or cancel",
    },
    "appointment.reminder_24h": {
      subject: (c) => `Reminder: your appointment at ${c.salonName} is tomorrow`,
      headline: (c, w) => `This is a reminder of your appointment at ${c.salonName} on ${w}.`,
      pushTitle: (c) => `Tomorrow at ${c.salonName}`,
      linkLabel: "Confirm or cancel",
    },
    "appointment.reminder_2h": {
      subject: (c) => `Reminder: your appointment at ${c.salonName} is in 2 hours`,
      headline: (c, w) => `Your appointment at ${c.salonName} starts in about 2 hours, at ${w}.`,
      pushTitle: (c) => `Soon at ${c.salonName}`,
      confirmLine: "Please confirm your appointment using the link below.",
      linkLabel: "Confirm or cancel",
    },
    "appointment.changed": {
      subject: (c) => `Your appointment at ${c.salonName} has changed`,
      headline: (c, w) => `Your appointment at ${c.salonName} has changed. It is now on ${w}.`,
      pushTitle: (c) => `Changed at ${c.salonName}`,
      linkLabel: "Confirm or cancel",
    },
    "appointment.cancelled": {
      subject: (c) => `Your appointment at ${c.salonName} was cancelled`,
      headline: (c, w) => `Your appointment at ${c.salonName} on ${w} was cancelled.`,
      pushTitle: (c) => `Cancelled at ${c.salonName}`,
      linkLabel: "Book again",
    },
  },
};
