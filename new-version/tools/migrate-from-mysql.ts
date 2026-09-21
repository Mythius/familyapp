// One-time data migration: copies the old MySQL `family_db` (people, roots,
// owned_families, family_permissions, security) into the new Postgres schema
// (people, family, users). Run with: bun tools/migrate-from-mysql.ts
//
// Source connection comes from MYSQL_MIGRATE_URL, not DATABASE_URL — the
// target Postgres database is whatever DATABASE_URL (used by ./prisma.ts)
// points at.
import mysql from "mysql2/promise";
import { prisma } from "./prisma.ts";

const MYSQL_MIGRATE_URL = process.env.MYSQL_MIGRATE_URL;
if (!MYSQL_MIGRATE_URL) {
  console.error("MYSQL_MIGRATE_URL is not set");
  process.exit(1);
}

interface OldPerson {
  ID: number;
  family_id: string;
  name: string | null;
  gender: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  generation: string | null;
  birthday: string | null;
  mother_id: number | null;
  father_id: number | null;
  spouse_id: number | null;
  marriage_date: string | null;
  death_date: string | null;
  maiden_name: string | null;
  photo: string | null;
  notes: string | null;
  order: string | null;
  facebook: string | null;
  instagram: string | null;
  flag1: string | null;
  flag2: string | null;
}

interface OldRoot {
  root_id: number;
  family_id: string | null;
  father_id: string | null;
  mother_id: string | null;
}

interface OldOwnedFamily {
  id: number;
  email: string;
  family_id: string | null;
}

interface OldFamilyPermission {
  id: number;
  email: string;
  family_id: string;
  role: "editor" | "viewer";
}

interface OldSecurity {
  email: string;
  role: string;
  logins: number;
}

function parseDate(value: string | null): Date | null {
  if (!value || value === "0000-00-00") return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function parseIntOrNull(value: string | number | null): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : parseInt(value, 10);
  return isNaN(n) ? null : n;
}

async function main() {
  const conn = await mysql.createConnection({
    uri: MYSQL_MIGRATE_URL,
    dateStrings: true,
  });

  console.log("Reading old MySQL tables...");
  const [people] = await conn.query<any[]>("SELECT * FROM people");
  const [roots] = await conn.query<any[]>("SELECT * FROM roots");
  const [ownedFamilies] = await conn.query<any[]>(
    "SELECT * FROM owned_families",
  );
  const [familyPermissions] = await conn.query<any[]>(
    "SELECT * FROM family_permissions",
  );
  const [security] = await conn.query<any[]>("SELECT * FROM security");
  await conn.end();

  const oldPeople = people as OldPerson[];
  const oldRoots = roots as OldRoot[];
  const oldOwned = ownedFamilies as OldOwnedFamily[];
  const oldPerms = familyPermissions as OldFamilyPermission[];
  const oldSecurity = security as OldSecurity[];

  console.log(
    `people=${oldPeople.length} roots=${oldRoots.length} owned_families=${oldOwned.length} family_permissions=${oldPerms.length} security=${oldSecurity.length}`,
  );

  // Union of every family_id actually used by people/owned_families/family_permissions.
  // Deliberately excludes family_ids that only appear in `roots` with no owner and no
  // people (e.g. "southwick" / "Nathan Southwick" in the source data) — those are stale
  // duplicate root definitions left over from before a family was renamed, unreachable
  // through the app (getFamilyPermissions/getVisiblePeopleIds never surface a family with
  // no owner and no people), and redundant with a differently-named family that already
  // covers the same root ancestors.
  const familyIds = new Set<string>();
  for (const p of oldPeople) if (p.family_id) familyIds.add(p.family_id);
  for (const o of oldOwned) if (o.family_id) familyIds.add(o.family_id);
  for (const p of oldPerms) if (p.family_id) familyIds.add(p.family_id);

  const skippedRoots = oldRoots.filter(
    (r) => r.family_id && !familyIds.has(r.family_id),
  );
  if (skippedRoots.length) {
    console.log(
      `Skipping ${skippedRoots.length} orphaned root row(s) with no owner/people: ${skippedRoots
        .map((r) => r.family_id)
        .join(", ")}`,
    );
  }

  const familyRecords = Array.from(familyIds).map((familyId) => {
    const ownerRows = oldOwned.filter((o) => o.family_id === familyId);
    if (ownerRows.length > 1) {
      console.warn(
        `family_id "${familyId}" has ${ownerRows.length} owned_families rows; using the first (${ownerRows[0]!.email})`,
      );
    }
    const root = oldRoots.find((r) => r.family_id === familyId);
    const permissions = oldPerms
      .filter((p) => p.family_id === familyId)
      .map((p) => ({ email: p.email, role: p.role }));

    return {
      familyId,
      owner: ownerRows[0]?.email ?? null,
      fatherId: parseIntOrNull(root?.father_id ?? null),
      motherId: parseIntOrNull(root?.mother_id ?? null),
      permissions,
    };
  });

  const personRecords = oldPeople.map((p) => ({
    id: p.ID,
    familyId: p.family_id,
    name: p.name,
    gender: p.gender,
    address: p.address,
    phone: p.phone,
    email: p.email,
    generation: p.generation,
    birthday: parseDate(p.birthday),
    motherId: p.mother_id,
    fatherId: p.father_id,
    spouseId: p.spouse_id,
    marriageDate: parseDate(p.marriage_date),
    deathDate: parseDate(p.death_date),
    maidenName: p.maiden_name,
    photo: p.photo,
    notes: p.notes,
    order: p.order,
    facebook: p.facebook,
    instagram: p.instagram,
    flag1: p.flag1,
    flag2: p.flag2,
  }));

  const userRecords = oldSecurity.map((s) => ({
    email: s.email,
    role: s.role,
    logins: s.logins,
  }));

  console.log("Wiping target tables (person, family, user)...");
  await prisma.person.deleteMany();
  await prisma.family.deleteMany();
  await prisma.user.deleteMany();

  console.log(`Inserting ${familyRecords.length} family rows...`);
  await prisma.family.createMany({ data: familyRecords });

  console.log(`Inserting ${personRecords.length} person rows...`);
  await prisma.person.createMany({ data: personRecords });

  console.log(`Inserting ${userRecords.length} user rows...`);
  await prisma.user.createMany({ data: userRecords });

  // Explicit `id` values were used above to preserve father/mother/spouse
  // cross-references, so the "people_ID_seq" sequence needs to catch up.
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('people', 'ID'), COALESCE((SELECT MAX("ID") FROM people), 1))`,
  );

  console.log("Migration complete.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
