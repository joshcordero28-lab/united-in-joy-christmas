import { PrismaClient, CompetitionType, StaffRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const organizerPassword = process.env.ORGANIZER_PASSWORD || "ChangeMeOrganizer!";
  const staffPassword = process.env.STAFF_PASSWORD || "ChangeMeStaff!";
  const organizerUsername = process.env.ORGANIZER_USERNAME || "organizer";
  const staffUsername = process.env.STAFF_USERNAME || "checkin";

  await prisma.eventConfig.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      name: "United in Love Christmas Party",
      dateLabel: "[EVENT DATE — TBD]",
      venueLabel: "[VENUE — TBD]",
      capacity: 200,
      registrationOpen: true,
      requireApproval: false,
      votingEnabledAfterCheckIn: true,
      allowSelfVote: false,
    },
    update: {},
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
