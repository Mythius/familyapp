// Domain logic for the family registry: visibility/permission resolution and
// person-relationship helpers. Ported from the prototype's api.js, adapted to
// the merged Prisma schema (Family absorbs the old roots/owned_families/
// family_permissions tables) and Postgres.
import { prisma } from "./tools/prisma.ts";

export type Role = "owner" | "editor" | "viewer";
export interface FamilyPermissionEntry {
  email: string;
  role: "editor" | "viewer";
}

export function parseIntOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : parseInt(String(value), 10);
  return isNaN(n) ? null : n;
}

// Fields a client is allowed to set directly on a Person via the custom
// /people routes (request keys are snake_case for continuity with the old
// API; family_id/id are deliberately excluded — moving a person between
// families, or editing relationships, goes through dedicated checks).
export const PERSON_FIELD_MAP: Record<string, string> = {
  name: "name",
  gender: "gender",
  address: "address",
  phone: "phone",
  email: "email",
  generation: "generation",
  birthday: "birthday",
  marriage_date: "marriageDate",
  death_date: "deathDate",
  maiden_name: "maidenName",
  photo: "photo",
  notes: "notes",
  order: "order",
  facebook: "facebook",
  instagram: "instagram",
  flag1: "flag1",
  flag2: "flag2",
};
const PERSON_DATE_FIELDS = new Set(["birthday", "marriage_date", "death_date"]);

export function buildPersonData(body: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [snakeKey, prismaKey] of Object.entries(PERSON_FIELD_MAP)) {
    const value = body[snakeKey];
    // Only "not sent at all" is skipped — an explicit "" is the client
    // clearing the field, and must still reach the update/create data so
    // it overwrites whatever was there before.
    if (value === undefined) continue;
    if (PERSON_DATE_FIELDS.has(snakeKey)) {
      const d = new Date(value as string);
      data[prismaKey] = isNaN(d.getTime()) ? null : d;
    } else {
      data[prismaKey] = typeof value === "string" ? value.trim() : value;
    }
  }
  return data;
}

// Families a user is connected to: genealogically (walking up from their own
// person record through parents/spouses to find which family's root ancestors
// they descend from) or administratively (families they own or have been
// granted access to).
export async function getFamilyIds(email: string): Promise<string[]> {
  const [allPeople, families] = await Promise.all([
    prisma.person.findMany(),
    prisma.family.findMany(),
  ]);

  const ownedIds = families.filter((f) => f.owner === email).map((f) => f.familyId);
  const person = allPeople.find((p) => p.email === email);
  if (!person) return [...new Set(ownedIds)];

  const spouseIds = allPeople.filter((p) => p.spouseId === person.id).map((p) => p.id);
  const allIds = new Set<number>([person.id, ...spouseIds]);
  if (person.spouseId) allIds.add(person.spouseId);
  const stack = new Set<number>(allIds);

  while (stack.size > 0) {
    const currentId = stack.values().next().value as number;
    stack.delete(currentId);
    const current = allPeople.find((p) => p.id === currentId);
    if (!current) continue;
    if (current.fatherId && !allIds.has(current.fatherId)) {
      allIds.add(current.fatherId);
      stack.add(current.fatherId);
    }
    if (current.motherId && !allIds.has(current.motherId)) {
      allIds.add(current.motherId);
      stack.add(current.motherId);
    }
  }

  const idList = Array.from(allIds);
  const rootFamilyIds = families
    .filter((f) => (f.fatherId && idList.includes(f.fatherId)) || (f.motherId && idList.includes(f.motherId)))
    .map((f) => f.familyId);

  return [...new Set([...rootFamilyIds, ...ownedIds])];
}

// Owner / explicit editor-viewer grants only, keyed by family_id -- excludes
// implicit genealogical editor access. This is the set of families where the
// caller has an administrative stake (not just a blood connection), so it's
// safe to grant visibility into everyone filed under that family_id even if
// their tree pointers are broken/incomplete.
async function getExplicitFamilyRoles(email: string): Promise<Record<string, Role>> {
  const families = await prisma.family.findMany();
  const roles: Record<string, Role> = {};
  for (const f of families) {
    if (f.owner === email) roles[f.familyId] = "owner";
  }
  for (const f of families) {
    if (roles[f.familyId]) continue;
    const entries = (f.permissions as unknown as FamilyPermissionEntry[]) ?? [];
    const grant = entries.find((e) => e.email === email);
    if (grant) roles[f.familyId] = grant.role;
  }
  return roles;
}

// Merges owner / explicit editor-viewer grants / implicit genealogical editor
// access into one { family_id: role } map. Owner > explicit grant > implicit editor.
export async function getFamilyPermissions(email: string): Promise<Record<string, Role>> {
  const memberFamilyIds = await getFamilyIds(email);
  const permissions = await getExplicitFamilyRoles(email);
  for (const fid of memberFamilyIds) {
    if (!permissions[fid]) permissions[fid] = "editor";
  }
  return permissions;
}

export async function canEditFamily(email: string, familyId: string): Promise<boolean> {
  const permissions = await getFamilyPermissions(email);
  const role = permissions[familyId];
  return role === "owner" || role === "editor";
}

export async function getEditableFamilyIds(email: string): Promise<string[]> {
  const permissions = await getFamilyPermissions(email);
  return Object.entries(permissions)
    .filter(([, role]) => role === "owner" || role === "editor")
    .map(([fid]) => fid);
}

// Starting from each family's root ancestors (plus everyone in any family the
// user owns/has been granted access to), walks down through children/spouses
// to build the full visible set.
export async function getVisiblePeopleIds(familyIds: string[], email: string | null): Promise<number[]> {
  if (!familyIds.length) return [];
  const allPeople = await prisma.person.findMany();
  const visible = new Set<number>();

  if (email) {
    // Only an explicit owner/grant unlocks "everyone tagged with this
    // family_id" regardless of tree position -- implicit (blood-only) access
    // must go through the actual root-ancestor walk below, not the tag.
    const explicitRoles = await getExplicitFamilyRoles(email);
    const explicitFamilyIds = new Set(Object.keys(explicitRoles));
    for (const p of allPeople) {
      if (explicitFamilyIds.has(p.familyId)) visible.add(p.id);
    }
  }

  const roots = await prisma.family.findMany({ where: { familyId: { in: familyIds } } });
  for (const r of roots) {
    if (r.fatherId) visible.add(r.fatherId);
    if (r.motherId) visible.add(r.motherId);
  }

  const toProcess = new Set(visible);
  while (toProcess.size > 0) {
    const currentId = toProcess.values().next().value as number;
    toProcess.delete(currentId);

    const children = allPeople.filter((p) => p.fatherId === currentId || p.motherId === currentId);
    for (const child of children) {
      if (!visible.has(child.id)) {
        visible.add(child.id);
        toProcess.add(child.id);
      }
      if (child.spouseId && !visible.has(child.spouseId)) visible.add(child.spouseId);
    }

    for (const spouse of allPeople.filter((p) => p.spouseId === currentId)) {
      if (!visible.has(spouse.id)) visible.add(spouse.id);
    }
  }

  return Array.from(visible);
}

// Full person record + father/mother/spouse/children names & ids, restricted
// to whatever the caller has already determined is visible to the requester.
export async function getPersonDetail(name: string, visibleIds: number[]) {
  const person = await prisma.person.findFirst({ where: { name, id: { in: visibleIds } } });
  if (!person) return null;

  const spouseWhere = person.spouseId
    ? { OR: [{ id: person.spouseId }, { spouseId: person.id }] }
    : { spouseId: person.id };

  const [father, mother, spouses, children] = await Promise.all([
    person.fatherId ? prisma.person.findUnique({ where: { id: person.fatherId } }) : null,
    person.motherId ? prisma.person.findUnique({ where: { id: person.motherId } }) : null,
    prisma.person.findMany({ where: spouseWhere, orderBy: { marriageDate: "asc" } }),
    prisma.person.findMany({
      where: { OR: [{ fatherId: person.id }, { motherId: person.id }] },
      orderBy: { birthday: "asc" },
    }),
  ]);

  return {
    ...person,
    father_name: father?.name ?? null,
    father_id: father?.id ?? null,
    mother_name: mother?.name ?? null,
    mother_id: mother?.id ?? null,
    spouse_names: spouses.map((s) => s.name).join(","),
    spouse_ids: spouses.map((s) => s.id).join(","),
    children_names: children.map((c) => c.name).join(","),
    children_ids: children.map((c) => c.id).join(","),
  };
}

// Generation labels for tree rendering: 1 = root/spouse, 2 = children,
// 2.1 = child's 1st spouse, 2.2 = 2nd spouse, 3 = grandchildren, etc.
export async function getDescendantsWithGenerations(personId: number): Promise<Record<number, string>> {
  const allPeople = await prisma.person.findMany();
  const generations = new Map<number, string>();
  const bloodDescendants = new Set<number>([personId]);
  generations.set(personId, "1");

  const selected = allPeople.find((p) => p.id === personId);
  if (selected?.spouseId) generations.set(selected.spouseId, "1");
  for (const spouse of allPeople.filter((p) => p.spouseId === personId)) {
    generations.set(spouse.id, "1");
  }

  let currentGeneration = [personId];
  let genNumber = 1;

  while (currentGeneration.length > 0) {
    genNumber++;
    const nextGeneration: number[] = [];

    for (const parentId of currentGeneration) {
      const children = allPeople.filter((p) => p.fatherId === parentId || p.motherId === parentId);
      for (const child of children) {
        if (bloodDescendants.has(child.id)) continue;
        bloodDescendants.add(child.id);
        generations.set(child.id, String(genNumber));
        nextGeneration.push(child.id);

        let spouseCount = 0;
        if (child.spouseId && !generations.has(child.spouseId)) {
          spouseCount++;
          generations.set(child.spouseId, `${genNumber}.${spouseCount}`);
        }
        for (const spouse of allPeople.filter((p) => p.spouseId === child.id)) {
          if (!generations.has(spouse.id)) {
            spouseCount++;
            generations.set(spouse.id, `${genNumber}.${spouseCount}`);
          }
        }
      }
    }

    currentGeneration = nextGeneration;
  }

  return Object.fromEntries(generations);
}
