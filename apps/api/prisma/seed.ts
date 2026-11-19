/**
 * Idempotent development seed: a demo salon (nails, hair, brows, facials, massages, body)
 * with staff, schedules, resources, customers and three upcoming appointments.
 * Natural keys: org slug, location name, level/category/resource-type/service `name.en`,
 * staff email, resource name, customer phone. Appointments whose notes start with "[seed]"
 * are deleted and recreated on every run.
 *
 * DEV ONLY: customers and appointments are demo data. Never point this at a real database;
 * `main()` refuses NODE_ENV=production.
 * Run: pnpm --filter @beautyspa/api db:seed (uses DATABASE_URL).
 */
import { DEFAULT_LOCATION_SETTINGS } from "@beautyspa/contracts";
import {
  addDays,
  todayIn,
  wallTimeToUtc,
  weekdayOf,
  type IsoDate,
} from "@beautyspa/datetime";
import { PrismaClient } from "@prisma/client";

const TZ = "America/New_York";
const SEED_NOTE = "[seed]";

export interface SeedCounts {
  levels: number;
  categories: number;
  services: number;
  levelPrices: number;
  resourceTypes: number;
  resources: number;
  staff: number;
  workingHours: number;
  customers: number;
  consents: number;
  appointments: number;
  segments: number;
}

type Text = { en: string; es: string };
const t = (en: string, es: string): Text => ({ en, es });
const time = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);
const enOf = (name: unknown): string => (name as Text).en;

type ResourceKey = "chair" | "cabin" | null;
interface ServiceDef {
  category: string;
  en: string;
  es: string;
  min: number;
  buffer: number;
  cents: number;
  parallel: boolean;
  resource: ResourceKey;
}

const s = (
  category: string,
  en: string,
  es: string,
  min: number,
  buffer: number,
  cents: number,
  parallel = false,
  resource: ResourceKey = null,
): ServiceDef => ({ category, en, es, min, buffer, cents, parallel, resource });

const SERVICES: ServiceDef[] = [
  s("Nails", "Classic manicure", "Manicura clásica", 30, 5, 2500, true),
  s("Nails", "Gel manicure", "Manicura en gel", 45, 5, 4000, true),
  s(
    "Nails",
    "Classic pedicure",
    "Pedicura clásica",
    45,
    10,
    3500,
    true,
    "chair",
  ),
  s("Nails", "Spa pedicure", "Pedicura spa", 60, 10, 5000, true, "chair"),
  s("Nails", "Acrylic full set", "Juego completo acrílico", 75, 10, 6000),
  s("Nails", "Acrylic fill", "Relleno acrílico", 60, 10, 4500),
  s("Nails", "Nail art (per set)", "Diseño de uñas", 15, 0, 1500),
  s("Hair", "Women's haircut", "Corte de dama", 45, 10, 5000),
  s("Hair", "Men's haircut", "Corte de caballero", 30, 5, 3000),
  s("Hair", "Blowout", "Secado y peinado", 45, 5, 4000),
  s("Hair", "Root color", "Tinte de raíz", 90, 15, 8500),
  s("Hair", "Highlights", "Mechas", 120, 15, 15000),
  s("Brows & lashes", "Brow wax", "Depilación de cejas", 15, 5, 1500),
  s("Brows & lashes", "Brow tint", "Tinte de cejas", 20, 5, 2000),
  s("Brows & lashes", "Lash lift", "Lifting de pestañas", 60, 10, 7000),
  s(
    "Facials",
    "Deep cleansing facial",
    "Limpieza facial profunda",
    60,
    10,
    7000,
    false,
    "cabin",
  ),
  s(
    "Facials",
    "Hydrating facial",
    "Facial hidratante",
    60,
    10,
    8500,
    false,
    "cabin",
  ),
  s(
    "Massages & body",
    "Relaxing massage",
    "Masaje relajante",
    60,
    10,
    8000,
    false,
    "cabin",
  ),
  s(
    "Massages & body",
    "Deep tissue massage",
    "Masaje de tejido profundo",
    60,
    10,
    9500,
    false,
    "cabin",
  ),
  s(
    "Massages & body",
    "Body scrub",
    "Exfoliación corporal",
    45,
    10,
    6500,
    false,
    "cabin",
  ),
];

const CATEGORIES: [string, string][] = [
  ["Nails", "Uñas"],
  ["Hair", "Cabello"],
  ["Brows & lashes", "Cejas y pestañas"],
  ["Facials", "Faciales"],
  ["Massages & body", "Masajes y corporales"],
];

const SENIOR_PRICES: Record<string, number> = {
  "Women's haircut": 6000,
  "Root color": 9500,
  Highlights: 17000,
};

interface EmployeeDef {
  name: string;
  email: string;
  level: "Junior" | "Senior";
  categories: string[];
  extra: string[];
}

const EMPLOYEES: EmployeeDef[] = [
  {
    name: "Ana Rivera",
    email: "ana@demo-salon.test",
    level: "Senior",
    categories: ["Nails"],
    extra: [],
  },
  {
    name: "Carmen López",
    email: "carmen@demo-salon.test",
    level: "Junior",
    categories: ["Nails"],
    extra: ["Brow wax"],
  },
  {
    name: "Luis Ortega",
    email: "luis@demo-salon.test",
    level: "Senior",
    categories: ["Hair"],
    extra: [],
  },
  {
    name: "Sofía Méndez",
    email: "sofia@demo-salon.test",
    level: "Junior",
    categories: ["Brows & lashes"],
    extra: ["Women's haircut", "Blowout"],
  },
  {
    name: "Valeria Cruz",
    email: "valeria@demo-salon.test",
    level: "Senior",
    categories: ["Facials", "Massages & body"],
    extra: [],
  },
];

/** Monday (1) to Saturday (6), 09:00-19:00. */
const OPEN_WEEKDAYS = [1, 2, 3, 4, 5, 6];
/** Employees work Tuesday (2) to Saturday (6). */
const WORK_WEEKDAYS = [2, 3, 4, 5, 6];
const SHIFTS: [string, string][] = [
  ["09:00", "13:00"],
  ["14:00", "19:00"],
];

export async function seed(
  prisma: PrismaClient,
  opts: { today?: IsoDate } = {},
): Promise<SeedCounts> {
  const today = opts.today ?? todayIn(TZ, Date.now());

  const org = await prisma.organization.upsert({
    where: { slug: "demo-salon" },
    update: { name: "Demo Salon", defaultLocale: "es" },
    create: { slug: "demo-salon", name: "Demo Salon", defaultLocale: "es" },
  });
  const orgId = org.id;

  await prisma.$transaction(async (tx) => {
    // Location and hours.
    const locData = {
      timezone: TZ,
      address: "123 Main St, Queens, NY",
      phone: "+17185550100",
      settings: DEFAULT_LOCATION_SETTINGS,
    };
    const existingLoc = await tx.location.findFirst({
      where: { organizationId: orgId, name: "Main" },
    });
    const location = existingLoc
      ? await tx.location.update({
          where: { id: existingLoc.id },
          data: locData,
        })
      : await tx.location.create({
          data: { organizationId: orgId, name: "Main", ...locData },
        });
    await tx.locationHours.deleteMany({ where: { locationId: location.id } });
    await tx.locationHours.createMany({
      data: OPEN_WEEKDAYS.map((weekday) => ({
        locationId: location.id,
        weekday,
        opens: time("09:00"),
        closes: time("19:00"),
      })),
    });

    // Levels.
    const existingLevels = await tx.level.findMany({
      where: { organizationId: orgId },
    });
    const levels = new Map<string, string>();
    for (const [rank, name] of [
      [1, "Junior"],
      [2, "Senior"],
    ] as const) {
      const found = existingLevels.find((l) => enOf(l.name) === name);
      const row = found
        ? await tx.level.update({
            where: { id: found.id },
            data: { name: t(name, name), rank },
          })
        : await tx.level.create({
            data: { organizationId: orgId, name: t(name, name), rank },
          });
      levels.set(name, row.id);
    }

    // Resource types and resources.
    const existingTypes = await tx.resourceType.findMany({
      where: { organizationId: orgId },
    });
    const types = new Map<string, string>();
    const typeDefs: [string, Text, string[]][] = [
      [
        "chair",
        t("Pedicure chair", "Silla de pedicura"),
        ["Chair 1", "Chair 2", "Chair 3"],
      ],
      [
        "cabin",
        t("Treatment cabin", "Cabina de tratamiento"),
        ["Cabin 1", "Cabin 2"],
      ],
    ];
    const resourceIds = new Map<string, string>();
    for (const [key, name, resourceNames] of typeDefs) {
      const found = existingTypes.find((x) => enOf(x.name) === name.en);
      const row = found
        ? await tx.resourceType.update({
            where: { id: found.id },
            data: { name },
          })
        : await tx.resourceType.create({
            data: { organizationId: orgId, name },
          });
      types.set(key, row.id);
      for (const rname of resourceNames) {
        const existing = await tx.resource.findFirst({
          where: {
            organizationId: orgId,
            locationId: location.id,
            name: rname,
          },
        });
        const r = existing
          ? await tx.resource.update({
              where: { id: existing.id },
              data: { resourceTypeId: row.id, active: true },
            })
          : await tx.resource.create({
              data: {
                organizationId: orgId,
                locationId: location.id,
                resourceTypeId: row.id,
                name: rname,
              },
            });
        resourceIds.set(rname, r.id);
      }
    }

    // Categories.
    const existingCats = await tx.serviceCategory.findMany({
      where: { organizationId: orgId },
    });
    const categories = new Map<string, string>();
    for (const [i, [en, es]] of CATEGORIES.entries()) {
      const found = existingCats.find((c) => enOf(c.name) === en);
      const row = found
        ? await tx.serviceCategory.update({
            where: { id: found.id },
            data: { name: t(en, es), sort: i + 1 },
          })
        : await tx.serviceCategory.create({
            data: { organizationId: orgId, name: t(en, es), sort: i + 1 },
          });
      categories.set(en, row.id);
    }

    // Services and Senior level prices.
    const existingServices = await tx.service.findMany({
      where: { organizationId: orgId },
    });
    const services = new Map<string, { id: string; def: ServiceDef }>();
    for (const def of SERVICES) {
      const data = {
        categoryId: categories.get(def.category)!,
        name: t(def.en, def.es),
        durationMin: def.min,
        bufferAfterMin: def.buffer,
        priceCents: def.cents,
        parallelizable: def.parallel,
        resourceTypeId: def.resource ? types.get(def.resource)! : null,
        onlineBookable: true,
        active: true,
      };
      const found = existingServices.find((x) => enOf(x.name) === def.en);
      const row = found
        ? await tx.service.update({ where: { id: found.id }, data })
        : await tx.service.create({ data: { organizationId: orgId, ...data } });
      services.set(def.en, { id: row.id, def });
    }
    const seniorId = levels.get("Senior")!;
    for (const [en, priceCents] of Object.entries(SENIOR_PRICES)) {
      const { id: serviceId, def } = services.get(en)!;
      await tx.serviceLevelPrice.upsert({
        where: { serviceId_levelId: { serviceId, levelId: seniorId } },
        update: { durationMin: def.min, priceCents },
        create: {
          serviceId,
          levelId: seniorId,
          durationMin: def.min,
          priceCents,
        },
      });
    }

    // Employees, assignments and working hours.
    const staffIds = new Map<string, string>();
    for (const e of EMPLOYEES) {
      const levelId = levels.get(e.level)!;
      const base = {
        role: "EMPLOYEE" as const,
        canLogin: false,
        locale: "es",
        active: true,
      };
      const user = await tx.staffUser.upsert({
        where: {
          organizationId_email: { organizationId: orgId, email: e.email },
        },
        update: base,
        create: { organizationId: orgId, email: e.email, ...base },
      });
      staffIds.set(e.name, user.id);
      await tx.employeeProfile.upsert({
        where: { staffUserId: user.id },
        update: { displayName: e.name, levelId, bookableOnline: true },
        create: {
          staffUserId: user.id,
          displayName: e.name,
          levelId,
          bookableOnline: true,
        },
      });
      await tx.staffLocation.upsert({
        where: {
          staffUserId_locationId: {
            staffUserId: user.id,
            locationId: location.id,
          },
        },
        update: {},
        create: { staffUserId: user.id, locationId: location.id },
      });
      const assigned = SERVICES.filter(
        (d) => e.categories.includes(d.category) || e.extra.includes(d.en),
      );
      await tx.employeeService.deleteMany({ where: { staffUserId: user.id } });
      await tx.employeeService.createMany({
        data: assigned.map((d) => ({
          staffUserId: user.id,
          serviceId: services.get(d.en)!.id,
        })),
      });
      await tx.workingHours.deleteMany({
        where: { staffUserId: user.id, locationId: location.id },
      });
      await tx.workingHours.createMany({
        data: WORK_WEEKDAYS.flatMap((weekday) =>
          SHIFTS.map(([start, end]) => ({
            organizationId: orgId,
            staffUserId: user.id,
            locationId: location.id,
            weekday,
            startTime: time(start),
            endTime: time(end),
          })),
        ),
      });
    }

    // Customers and consents.
    const customerDefs: {
      name: string;
      phone: string;
      locale: string;
      whatsapp: boolean;
    }[] = [
      {
        name: "María Gómez",
        phone: "+17185550101",
        locale: "es",
        whatsapp: true,
      },
      {
        name: "Jennifer Smith",
        phone: "+17185550102",
        locale: "en",
        whatsapp: false,
      },
      {
        name: "Rosa Díaz",
        phone: "+17185550103",
        locale: "es",
        whatsapp: true,
      },
    ];
    const customers = new Map<string, string>();
    for (const c of customerDefs) {
      const data = {
        name: c.name,
        locale: c.locale,
        createdVia: "RECEPTION" as const,
        phoneVerifiedAt: null,
      };
      const row = await tx.customer.upsert({
        where: {
          organizationId_phoneE164: {
            organizationId: orgId,
            phoneE164: c.phone,
          },
        },
        update: data,
        create: { organizationId: orgId, phoneE164: c.phone, ...data },
      });
      customers.set(c.name, row.id);
      if (
        c.whatsapp &&
        (await tx.notificationConsent.count({
          where: { customerId: row.id },
        })) === 0
      ) {
        await tx.notificationConsent.create({
          data: {
            organizationId: orgId,
            customerId: row.id,
            channel: "WHATSAPP",
            granted: true,
            source: "RECEPTION",
          },
        });
      }
    }

    // Appointments: recreated every run.
    await tx.appointment.deleteMany({
      where: { organizationId: orgId, notes: { startsWith: SEED_NOTE } },
    });
    let day = today;
    while (weekdayOf(day) < 2) day = addDays(day, 1);

    const book = async (
      customer: string,
      note: string,
      at: string,
      items: {
        service: string;
        staff: string;
        resource?: string;
        priceCents?: number;
      }[],
    ) => {
      const startsAt = new Date(wallTimeToUtc(day, at, TZ));
      const appt = await tx.appointment.create({
        data: {
          organizationId: orgId,
          locationId: location.id,
          customerId: customers.get(customer)!,
          status: "BOOKED",
          source: "RECEPTION",
          notes: `${SEED_NOTE} ${note}`,
        },
      });
      for (const item of items) {
        const { id: serviceId, def } = services.get(item.service)!;
        const endsAt = new Date(startsAt.getTime() + def.min * 60_000);
        await tx.appointmentSegment.create({
          data: {
            organizationId: orgId,
            appointmentId: appt.id,
            serviceId,
            staffUserId: staffIds.get(item.staff)!,
            resourceId: item.resource ? resourceIds.get(item.resource)! : null,
            startsAt,
            endsAt,
            blockEndsAt: new Date(endsAt.getTime() + def.buffer * 60_000),
            durationMin: def.min,
            priceCents: item.priceCents ?? def.cents,
          },
        });
      }
    };
    await book("María Gómez", "manicure and pedicure in parallel", "10:00", [
      { service: "Classic manicure", staff: "Ana Rivera" },
      {
        service: "Classic pedicure",
        staff: "Carmen López",
        resource: "Chair 1",
      },
    ]);
    await book("Jennifer Smith", "haircut", "11:00", [
      {
        service: "Women's haircut",
        staff: "Luis Ortega",
        priceCents: SENIOR_PRICES["Women's haircut"],
      },
    ]);
    await book("Rosa Díaz", "brow wax", "15:00", [
      { service: "Brow wax", staff: "Sofía Méndez" },
    ]);
  });

  const inOrg = { organizationId: orgId };
  const [
    levels,
    categories,
    services,
    levelPrices,
    resourceTypes,
    resources,
    staff,
    workingHours,
    customers,
    consents,
    appointments,
    segments,
  ] = await Promise.all([
    prisma.level.count({ where: inOrg }),
    prisma.serviceCategory.count({ where: inOrg }),
    prisma.service.count({ where: inOrg }),
    prisma.serviceLevelPrice.count({ where: { service: inOrg } }),
    prisma.resourceType.count({ where: inOrg }),
    prisma.resource.count({ where: inOrg }),
    prisma.staffUser.count({ where: inOrg }),
    prisma.workingHours.count({ where: inOrg }),
    prisma.customer.count({ where: inOrg }),
    prisma.notificationConsent.count({ where: inOrg }),
    prisma.appointment.count({ where: inOrg }),
    prisma.appointmentSegment.count({ where: inOrg }),
  ]);
  return {
    levels,
    categories,
    services,
    levelPrices,
    resourceTypes,
    resources,
    staff,
    workingHours,
    customers,
    consents,
    appointments,
    segments,
  };
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to run the development seed with NODE_ENV=production",
    );
  }
  const prisma = new PrismaClient();
  try {
    const counts = await seed(prisma);
    console.log(
      `seed ok: ${Object.entries(counts)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ")}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
