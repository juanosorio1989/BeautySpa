import type { Locale } from "@beautyspa/contracts";

export interface EmailContent {
  subject: string;
  text: string;
}

/** Invite email (link valid 72 h). Plain text, EN and ES. */
export function inviteEmail(locale: Locale, link: string): EmailContent {
  if (locale === "es") {
    return {
      subject: "Te invitaron a BeautySpa",
      text: [
        "Hola:",
        "",
        "Te invitaron a unirte al equipo en BeautySpa. Abre este enlace para crear tu contraseña y activar la verificación en dos pasos:",
        "",
        link,
        "",
        "El enlace vence en 72 horas y solo se puede usar una vez.",
        "Si no esperabas esta invitación, ignora este correo.",
      ].join("\n"),
    };
  }
  return {
    subject: "You're invited to BeautySpa",
    text: [
      "Hi,",
      "",
      "You've been invited to join the team on BeautySpa. Open this link to set your password and turn on two-step verification:",
      "",
      link,
      "",
      "The link expires in 72 hours and can be used once.",
      "If you weren't expecting this invitation, ignore this email.",
    ].join("\n"),
  };
}

/** Password reset email (link valid 1 h). Plain text, EN and ES. */
export function resetEmail(locale: Locale, link: string): EmailContent {
  if (locale === "es") {
    return {
      subject: "Restablece tu contraseña de BeautySpa",
      text: [
        "Hola:",
        "",
        "Recibimos una solicitud para restablecer tu contraseña de BeautySpa. Abre este enlace para elegir una nueva:",
        "",
        link,
        "",
        "El enlace vence en 1 hora y solo se puede usar una vez.",
        "Si no lo solicitaste, ignora este correo: tu contraseña no cambia.",
      ].join("\n"),
    };
  }
  return {
    subject: "Reset your BeautySpa password",
    text: [
      "Hi,",
      "",
      "We received a request to reset your BeautySpa password. Open this link to choose a new one:",
      "",
      link,
      "",
      "The link expires in 1 hour and can be used once.",
      "If you didn't ask for this, ignore this email: your password stays the same.",
    ].join("\n"),
  };
}
