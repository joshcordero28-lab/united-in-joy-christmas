import { PrismaClient, CompetitionType, StaffRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Set it before running seed (e.g. in .env or app secrets).`,
    );
  }
  return value;
}

async function main() {
  const organizerPassword = requireEnv("ORGANIZER_PASSWORD");
  const staffPassword = requireEnv("STAFF_PASSWORD");
  const organizerUsername = requireEnv("ORGANIZER_USERNAME");
  const staffUsername = requireEnv("STAFF_USERNAME");

  await prisma.eventConfig.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      name: "United in Joy Christmas 2026",
      dateLabel: "December 13, 2026",
      venueLabel: "[VENUE — TBD]",
      capacity: 200,
      registrationOpen: true,
      requireApproval: false,
      votingEnabledAfterCheckIn: true,
      allowSelfVote: false,
    },
    update: {
      name: "United in Joy Christmas 2026",
      dateLabel: "December 13, 2026",
    },
  });

  // Ensure talent voting column is present on older DBs without wiping other flags
  await prisma.eventConfig.update({
    where: { id: "default" },
    data: {},
  });

  const organizerHash = await bcrypt.hash(organizerPassword, 12);
  const staffHash = await bcrypt.hash(staffPassword, 12);

  await prisma.staffAccount.upsert({
    where: { username: organizerUsername },
    create: {
      username: organizerUsername,
      passwordHash: organizerHash,
      role: StaffRole.ORGANIZER,
      displayName: process.env.ORGANIZER_DISPLAY_NAME || "Event Organizer",
    },
    update: {
      passwordHash: organizerHash,
      role: StaffRole.ORGANIZER,
      displayName: process.env.ORGANIZER_DISPLAY_NAME || "Event Organizer",
    },
  });

  await prisma.staffAccount.upsert({
    where: { username: staffUsername },
    create: {
      username: staffUsername,
      passwordHash: staffHash,
      role: StaffRole.STAFF,
      displayName: process.env.STAFF_DISPLAY_NAME || "Check-in Staff",
    },
    update: {
      passwordHash: staffHash,
      role: StaffRole.STAFF,
      displayName: process.env.STAFF_DISPLAY_NAME || "Check-in Staff",
    },
  });

  const competitions = [
    {
      name: "Best Festive Outfit",
      description: "Individual style competition — dress to impress.",
      type: CompetitionType.INDIVIDUAL,
      maxEntries: 50,
      sortOrder: 1,
    },
    {
      name: "Carol Karaoke",
      description: "Solo vocal performance of a Christmas carol.",
      type: CompetitionType.INDIVIDUAL,
      maxEntries: 30,
      sortOrder: 2,
    },
    {
      name: "Family Talent Showcase",
      description: "Team act — 2 to 5 people.",
      type: CompetitionType.TEAM,
      maxEntries: 20,
      teamSizeMin: 2,
      teamSizeMax: 5,
      sortOrder: 3,
    },
    {
      name: "Cookie Decorating Relay",
      description: "Team of 3 — speed and creativity.",
      type: CompetitionType.TEAM,
      maxEntries: 15,
      teamSizeMin: 3,
      teamSizeMax: 3,
      sortOrder: 4,
    },
  ];

  for (const c of competitions) {
    const existing = await prisma.competition.findFirst({ where: { name: c.name } });
    if (!existing) {
      await prisma.competition.create({ data: c });
    }
  }

  console.log("Seed complete: event config, staff accounts, competitions.");
  console.log(`Organizer username: ${organizerUsername}`);
  console.log(`Staff username: ${staffUsername}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
