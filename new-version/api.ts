import { Hono, type Context } from "hono";
import type { Session } from "./tools/auth.ts";
import { exposePrismaCRUD, prisma } from "./tools/prisma.ts";
import { handlePrismaError, type PermissionResult } from "./tools/createCRUD.ts";
import { handleFileUpload } from "./tools/fileUpload.ts";
import {
  buildPersonData,
  canDeletePerson,
  canEditFamily,
  getDescendantsWithGenerations,
  getFamilyIds,
  getFamilyPermissions,
  getPersonDetail,
  getVisiblePeopleIds,
  parseIntOrNull,
  type FamilyPermissionEntry,
} from "./family.ts";

function session(c: Context): Session {
  return (c as any).get("session") as Session;
}

function requireEmail(c: Context): string | null {
  return session(c).email ?? null;
}

export function publicRoutes(_app: Hono): void {
  // Nothing public beyond what tools/auth.ts already mounts.
}

export function privateRoutes(app: Hono): void {
  app.get("/user", (c) => {
    const s = session(c);
    return c.json(s.cas_data || s.google_data || s.microsoft_data || { email: s.email });
  });

  app.post("/file-upload", async (c) => {
    const result = await handleFileUpload(c);
    return "error" in result ? c.json(result, 400) : c.json(result, 201);
  });

  // ---------------------------------------------------------------------
  // People
  // ---------------------------------------------------------------------
  app.get("/people", async (c) => {
    const email = requireEmail(c);
    if (!email) return c.json([]);
    const familyIds = await getFamilyIds(email);
    const visibleIds = await getVisiblePeopleIds(familyIds, email);
    if (!visibleIds.length) return c.json([]);
    const people = await prisma.person.findMany({ where: { id: { in: visibleIds } } });
    return c.json(people);
  });

  app.get("/people/:name", async (c) => {
    const email = requireEmail(c);
    if (!email) return c.json({ error: "No email on this session" }, 400);
    const name = decodeURIComponent(c.req.param("name"));
    const familyIds = await getFamilyIds(email);
    const visibleIds = await getVisiblePeopleIds(familyIds, email);
    if (!visibleIds.length) return c.json({ error: "Not found" }, 404);
    const detail = await getPersonDetail(name, visibleIds);
    if (!detail) return c.json({ error: "Not found" }, 404);
    return c.json({ ...detail, can_delete: await canDeletePerson(email, detail.id) });
  });

  app.post("/people/:name", async (c) => {
    const email = requireEmail(c);
    if (!email) return c.json({ error: "No email on this session" }, 400);
    const name = decodeURIComponent(c.req.param("name"));
    const body = await c.req.json();

    const familyIds = await getFamilyIds(email);
    const visibleIds = await getVisiblePeopleIds(familyIds, email);
    const person = await prisma.person.findFirst({ where: { name, id: { in: visibleIds } } });
    if (!person) return c.json({ error: "Person not found" }, 404);

    if (!(await canEditFamily(email, person.familyId))) {
      return c.json({ error: "You don't have edit permission for this family" }, 403);
    }

    const data = buildPersonData(body);

    if ("father_name" in body) {
      if (body.father_name) {
        const father = await prisma.person.findFirst({ where: { name: body.father_name, id: { in: visibleIds } } });
        data.fatherId = father?.id ?? null;
      } else {
        data.fatherId = null;
      }
    }
    if ("mother_name" in body) {
      if (body.mother_name) {
        const mother = await prisma.person.findFirst({ where: { name: body.mother_name, id: { in: visibleIds } } });
        data.motherId = mother?.id ?? null;
      } else {
        data.motherId = null;
      }
    }

    // A spouse link is a single spouseId pointer that can live on either
    // person's row (see getPersonDetail's spouseWhere, which reads both
    // directions) — so removing a spouse from the list has to clear
    // whichever side currently holds the link, not just add new ones.
    if ("spouse_names" in body) {
      const targetNames = String(body.spouse_names ?? "")
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);
      const targets = targetNames.length
        ? await prisma.person.findMany({ where: { name: { in: targetNames }, id: { in: visibleIds } } })
        : [];
      const targetIds = new Set(targets.map((p) => p.id));

      const currentSpouseWhere = person.spouseId
        ? { OR: [{ id: person.spouseId }, { spouseId: person.id }] }
        : { spouseId: person.id };
      const currentSpouses = await prisma.person.findMany({ where: currentSpouseWhere });

      for (const spouse of currentSpouses) {
        if (targetIds.has(spouse.id)) continue;
        if (spouse.spouseId === person.id) {
          await prisma.person.update({ where: { id: spouse.id }, data: { spouseId: null } });
        }
        if (person.spouseId === spouse.id) {
          data.spouseId = null;
        }
      }
      for (const spouse of targets) {
        if (spouse.spouseId === person.id || person.spouseId === spouse.id) continue;
        await prisma.person.update({ where: { id: spouse.id }, data: { spouseId: person.id } });
      }
    }

    // A child link is the child's own fatherId/motherId pointing back at
    // this person — same deal: removing a child from the list has to clear
    // their pointer, not just leave old children permanently attached.
    if ("children_names" in body) {
      const targetNames = String(body.children_names ?? "")
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);
      const targets = targetNames.length
        ? await prisma.person.findMany({ where: { name: { in: targetNames }, id: { in: visibleIds } } })
        : [];
      const targetIds = new Set(targets.map((p) => p.id));

      const currentChildren = await prisma.person.findMany({
        where: { OR: [{ fatherId: person.id }, { motherId: person.id }] },
      });
      for (const child of currentChildren) {
        if (targetIds.has(child.id)) continue;
        const clear: Record<string, unknown> = {};
        if (child.fatherId === person.id) clear.fatherId = null;
        if (child.motherId === person.id) clear.motherId = null;
        if (Object.keys(clear).length) {
          await prisma.person.update({ where: { id: child.id }, data: clear });
        }
      }
      for (const child of targets) {
        if (child.fatherId === person.id || child.motherId === person.id) continue;
        await prisma.person.update({ where: { id: child.id }, data: { fatherId: person.id } });
      }
    }

    if (Object.keys(data).length > 0) {
      await prisma.person.update({ where: { id: person.id }, data });
    }

    return c.json({ success: true });
  });

  app.post("/people", async (c) => {
    const email = requireEmail(c);
    if (!email) return c.json({ error: "No email on this session" }, 400);
    const body = await c.req.json();

    if (!body.name) return c.json({ error: "Name is required." }, 400);
    if (!body.family_id) return c.json({ error: "family_id is required." }, 400);
    if (!(await canEditFamily(email, body.family_id))) {
      return c.json({ error: "You don't have edit permission for this family" }, 403);
    }

    try {
      const person = await prisma.person.create({
        data: { familyId: body.family_id, ...buildPersonData(body) },
      });
      return c.json({ success: true, person });
    } catch (err) {
      return handlePrismaError(c, err);
    }
  });

  app.get("/descendants/:personId", async (c) => {
    const email = requireEmail(c);
    if (!email) return c.json({ error: "No email on this session" }, 400);
    const personId = parseInt(c.req.param("personId"), 10);
    if (isNaN(personId)) return c.json({ error: "Invalid person ID" }, 400);

    const familyIds = await getFamilyIds(email);
    const visibleIds = await getVisiblePeopleIds(familyIds, email);
    if (!visibleIds.includes(personId)) {
      return c.json({ error: "You don't have access to this person" }, 403);
    }
    return c.json(await getDescendantsWithGenerations(personId));
  });

  // ---------------------------------------------------------------------
  // Families & permissions
  // ---------------------------------------------------------------------
  app.get("/permissions", async (c) => {
    const email = requireEmail(c);
    if (!email) return c.json({ error: "No email on this session" }, 400);
    const user = await prisma.user.findUnique({ where: { email } });
    const familyPermissions = await getFamilyPermissions(email);
    return c.json({ ...user, family_permissions: familyPermissions });
  });

  app.get("/family_ids", async (c) => {
    const email = requireEmail(c);
    if (!email) return c.json({ error: "No email on this session" }, 400);
    const familyIds = await getFamilyIds(email);
    if (!familyIds.length) return c.json({ error: "No family IDs found for user." }, 404);
    return c.json(familyIds);
  });

  app.get("/getMyFamiliesRoots", async (c) => {
    const email = requireEmail(c);
    if (!email) return c.json([]);
    const familyIds = await getFamilyIds(email);
    if (!familyIds.length) return c.json([]);

    const families = await prisma.family.findMany({ where: { familyId: { in: familyIds } } });
    const results = await Promise.all(
      families.map(async (f) => {
        const [father, mother] = await Promise.all([
          f.fatherId ? prisma.person.findUnique({ where: { id: f.fatherId } }) : null,
          f.motherId ? prisma.person.findUnique({ where: { id: f.motherId } }) : null,
        ]);
        return { family_id: f.familyId, ancestor1: father?.name ?? null, ancestor2: mother?.name ?? null };
      }),
    );
    return c.json(results);
  });

  app.get("/my-family-permissions", async (c) => {
    const email = requireEmail(c);
    if (!email) return c.json({});
    return c.json(await getFamilyPermissions(email));
  });

  app.post("/family/:id", async (c) => {
    const email = requireEmail(c);
    if (!email) return c.json({ error: "No email on this session" }, 400);
    const familyId = c.req.param("id");

    const existing = await prisma.family.findUnique({ where: { familyId } });
    if (existing) {
      return c.json({ error: "A family with this name already exists. Please choose a unique name." }, 400);
    }

    await prisma.family.create({ data: { familyId, owner: email } });
    return c.json({ success: true, family_id: familyId });
  });

  app.post("/roots/:familyId", async (c) => {
    const email = requireEmail(c);
    if (!email) return c.json({ error: "No email on this session" }, 400);
    const familyId = c.req.param("familyId");
    const body = await c.req.json();

    if (!(await canEditFamily(email, familyId))) {
      return c.json({ error: "You don't have edit permission for this family" }, 403);
    }
    if (!body.father_id && !body.mother_id) {
      return c.json({ error: "At least 1 ancestor must be specified" }, 400);
    }

    try {
      const family = await prisma.family.update({
        where: { familyId },
        data: { fatherId: parseIntOrNull(body.father_id), motherId: parseIntOrNull(body.mother_id) },
      });
      return c.json({ success: true, data: family });
    } catch (err) {
      return handlePrismaError(c, err);
    }
  });

  app.get("/family-permissions/:familyId", async (c) => {
    const email = requireEmail(c);
    if (!email) return c.json({ error: "No email on this session" }, 400);
    const familyId = c.req.param("familyId");

    const permissions = await getFamilyPermissions(email);
    if (permissions[familyId] !== "owner") {
      return c.json({ error: "Only owners can view family permissions" }, 403);
    }
    const family = await prisma.family.findUnique({ where: { familyId } });
    return c.json(family?.permissions ?? []);
  });

  app.post("/family-permissions/:familyId", async (c) => {
    const email = requireEmail(c);
    if (!email) return c.json({ error: "No email on this session" }, 400);
    const familyId = c.req.param("familyId");
    const { email: grantEmail, role } = await c.req.json();

    if (!grantEmail || !role) return c.json({ error: "email and role are required" }, 400);
    if (role !== "editor" && role !== "viewer") return c.json({ error: "role must be 'editor' or 'viewer'" }, 400);

    const permissions = await getFamilyPermissions(email);
    if (permissions[familyId] !== "owner") {
      return c.json({ error: "Only owners can grant family permissions" }, 403);
    }

    const family = await prisma.family.findUnique({ where: { familyId } });
    if (!family) return c.json({ error: "Family not found" }, 404);

    const entries = (family.permissions as unknown as FamilyPermissionEntry[]) ?? [];
    const updated = [...entries.filter((e) => e.email !== grantEmail), { email: grantEmail, role }];
    await prisma.family.update({ where: { familyId }, data: { permissions: updated as any } });
    return c.json({ success: true, message: `Granted ${role} access to ${grantEmail}` });
  });

  app.delete("/family-permissions/:familyId/:email", async (c) => {
    const email = requireEmail(c);
    if (!email) return c.json({ error: "No email on this session" }, 400);
    const familyId = c.req.param("familyId");
    const revokeEmail = decodeURIComponent(c.req.param("email"));

    const permissions = await getFamilyPermissions(email);
    if (permissions[familyId] !== "owner") {
      return c.json({ error: "Only owners can revoke family permissions" }, 403);
    }

    const family = await prisma.family.findUnique({ where: { familyId } });
    if (!family) return c.json({ error: "Family not found" }, 404);

    const entries = (family.permissions as unknown as FamilyPermissionEntry[]) ?? [];
    const updated = entries.filter((e) => e.email !== revokeEmail);
    await prisma.family.update({ where: { familyId }, data: { permissions: updated as any } });
    return c.json({ success: true, message: `Revoked access from ${revokeEmail}` });
  });

  // ---------------------------------------------------------------------
  // Generic CRUD, locked down per-model to mirror the custom routes above.
  // ---------------------------------------------------------------------
  exposePrismaCRUD("api", app, checkCrudPermissions);
}

async function checkCrudPermissions(action: string, c: Context): Promise<PermissionResult> {
  const email = requireEmail(c);
  const [method, path] = action.split(":");
  const model = path!.split("/").pop();

  // `users` holds role/login data for every account — never exposed via raw CRUD.
  if (model === "user") return { allowed: false };
  if (!email) return { allowed: false };

  if (model === "person") {
    if (method === "GET") {
      const familyIds = await getFamilyIds(email);
      const visibleIds = await getVisiblePeopleIds(familyIds, email);
      return { allowed: true, rowLevelFilter: { id: { in: visibleIds.length ? visibleIds : [-1] } } };
    }
    if (method === "POST") {
      const body = await c.req.json().catch(() => ({}));
      if (!body.familyId) return { allowed: false };
      return { allowed: await canEditFamily(email, body.familyId) };
    }
    if (method === "PUT") {
      const id = parseIntOrNull(c.req.param("id"));
      if (id === null) return { allowed: false };
      const person = await prisma.person.findUnique({ where: { id } });
      if (!person) return { allowed: false };
      return { allowed: await canEditFamily(email, person.familyId) };
    }
    if (method === "DELETE") {
      const id = parseIntOrNull(c.req.param("id"));
      if (id === null) return { allowed: false };
      return { allowed: await canDeletePerson(email, id) };
    }
    return { allowed: false };
  }

  if (model === "family") {
    if (method === "GET") {
      const permissions = await getFamilyPermissions(email);
      const ids = Object.keys(permissions);
      return { allowed: true, rowLevelFilter: { familyId: { in: ids.length ? ids : ["__none__"] } } };
    }
    if (method === "POST") {
      // Owner is always the creator, regardless of what the client sends.
      return { allowed: true, rowLevelFilter: { owner: email } };
    }
    if (method === "PUT" || method === "DELETE") {
      const id = parseIntOrNull(c.req.param("id"));
      if (id === null) return { allowed: false };
      const family = await prisma.family.findUnique({ where: { id } });
      return { allowed: !!family && family.owner === email };
    }
    return { allowed: false };
  }

  return { allowed: false };
}

export async function onLogin(session: Session): Promise<void> {
  const email = session.email;
  if (!email) return;
  await prisma.user.upsert({
    where: { email },
    create: { email },
    update: { logins: { increment: 1 } },
  });
}
