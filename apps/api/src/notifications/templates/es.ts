import type { LocaleCopy } from "./types.js";

export const es: LocaleCopy = {
  greeting: (name) => (name ? `Hola ${name},` : "Hola,"),
  labels: { when: "Cuándo", services: "Servicios", where: "Dónde", phone: "¿Preguntas? Llama al", with: "con" },
  keys: {
    "appointment.confirmed": {
      subject: (c) => `Tu cita en ${c.salonName} está reservada`,
      headline: (c, w) => `Tu cita en ${c.salonName} está reservada para el ${w}.`,
      pushTitle: (c) => `Reservada en ${c.salonName}`,
      linkLabel: "Confirmar o cancelar",
    },
    "appointment.reminder_24h": {
      subject: (c) => `Recordatorio: tu cita en ${c.salonName} es mañana`,
      headline: (c, w) => `Te recordamos tu cita en ${c.salonName} el ${w}.`,
      pushTitle: (c) => `Mañana en ${c.salonName}`,
      linkLabel: "Confirmar o cancelar",
    },
    "appointment.reminder_2h": {
      subject: (c) => `Recordatorio: tu cita en ${c.salonName} es en 2 horas`,
      headline: (c, w) => `Tu cita en ${c.salonName} empieza en unas 2 horas, el ${w}.`,
      pushTitle: (c) => `Pronto en ${c.salonName}`,
      confirmLine: "Confirma tu cita con el siguiente enlace.",
      linkLabel: "Confirmar o cancelar",
    },
    "appointment.changed": {
      subject: (c) => `Tu cita en ${c.salonName} ha cambiado`,
      headline: (c, w) => `Tu cita en ${c.salonName} ha cambiado. Ahora es el ${w}.`,
      pushTitle: (c) => `Cambio en ${c.salonName}`,
      linkLabel: "Confirmar o cancelar",
    },
    "appointment.cancelled": {
      subject: (c) => `Tu cita en ${c.salonName} fue cancelada`,
      headline: (c, w) => `Tu cita en ${c.salonName} del ${w} fue cancelada.`,
      pushTitle: (c) => `Cancelada en ${c.salonName}`,
      linkLabel: "Reservar de nuevo",
    },
  },
};
