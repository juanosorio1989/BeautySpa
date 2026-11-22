import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import { en, es } from "@beautyspa/i18n";
import { appointment, emp, id, location, svc } from "./test-fixtures";
import { AppointmentSummary } from "./appointment-summary";

const services = [svc(1), svc(2)];
const employees = [emp(11, [id(1)]), emp(12, [id(2)])];

describe("AppointmentSummary", () => {
  it("shows date, time range in the location timezone, lines, total and address", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <AppointmentSummary
          appointment={appointment()}
          services={services}
          employees={employees}
          location={{ ...location, address: "12 Main St, Queens, NY" }}
          locale="en"
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Thursday, November 19, 2026")).toBeInTheDocument();
    expect(screen.getByText("11:00 AM – 11:45 AM")).toBeInTheDocument();
    expect(screen.getByText("Svc 1 · Emp 11")).toBeInTheDocument();
    expect(screen.getByText("$25.00")).toBeInTheDocument();
    expect(screen.getByText("Svc 2 · Emp 12")).toBeInTheDocument();
    expect(screen.getByText("Total at the salon")).toBeInTheDocument();
    expect(screen.getByText("$65.00")).toBeInTheDocument();
    expect(screen.getByText("12 Main St, Queens, NY")).toBeInTheDocument();
  });

  it("uses the Spanish copy and names", () => {
    render(
      <NextIntlClientProvider locale="es" messages={es}>
        <AppointmentSummary
          appointment={appointment()}
          services={services}
          employees={employees}
          location={location}
          locale="es"
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Serv 1 · Emp 11")).toBeInTheDocument();
    expect(screen.getByText("Total en el salón")).toBeInTheDocument();
  });
});
