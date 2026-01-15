const db = require("./db.js");
require("dotenv").config();
const h = "127.0.0.1";

db.dbServer.host = process.env.DB;
db.dbServer.user = process.env.DB_USER;
db.dbServer.password = process.env.DB_PASS;
db.ssh_config.password = process.env.SSH_PASS;
db.setQueryMode(process.env.DB_TYPE || "ssh");

exports.public = function (app) {
  app.get("/hello", (req, res) => {
    res.json({ message: "Hello World" });
  });
};

exports.private = function (app) {
  app.get("/hello2", (req, res) => {
    res.json({
      message:
        "Hello " +
        req.session.google_data.given_name +
        `<br><img src="${req.session.google_data.picture}">`,
    });
  });

  app.get("/people", async (req, res) => {
    await loadVisiblePeopleIds(req.session);

    if (!req.session.visible_people_ids || req.session.visible_people_ids.length === 0) {
      return res.json([]);
    }

    db.queryToCSV("family_db", "select * from people where ID in (?)", [
      req.session.visible_people_ids,
    ]).then((data) => {
      res.json(data);
    });
  });

  app.get("/people/:name", async (req, res) => {
    await loadVisiblePeopleIds(req.session);
    if (!req.session.visible_people_ids || req.session.visible_people_ids.length === 0) {
      return res.json([]);
    }
    let d = await db.query(
      "family_db",
      `SELECT
        p1.*,
        p2.name AS father_name,
        p2.ID AS father_id,
        p3.name AS mother_name,
        p3.ID AS mother_id,
        s.names AS spouse_names,
        s.IDs AS spouse_ids,
        group_concat(c.names) AS children_names,
        group_concat(c.IDs) AS children_ids
      FROM people p1
      LEFT JOIN people p2 ON p1.father_id = p2.ID
      LEFT JOIN people p3 ON p1.mother_id = p3.ID
      LEFT JOIN (
        SELECT
          spouse_link.person_id,
          GROUP_CONCAT(DISTINCT p.name ORDER BY p.marriage_date ASC) AS names,
          GROUP_CONCAT(DISTINCT p.ID ORDER BY p.marriage_date ASC) AS IDs
        FROM (
          SELECT ID AS person_id, spouse_id FROM people WHERE spouse_id IS NOT NULL
          UNION
          SELECT spouse_id AS person_id, ID AS spouse_id FROM people WHERE spouse_id IS NOT NULL
        ) spouse_link
        JOIN people p ON p.ID = spouse_link.spouse_id
        GROUP BY spouse_link.person_id
      ) s ON s.person_id = p1.ID
      LEFT JOIN (
        SELECT
          father_id, mother_id,
          GROUP_CONCAT(p.name ORDER BY p.birthday ASC) AS names,
          GROUP_CONCAT(p.ID ORDER BY p.birthday ASC) AS IDs
        FROM people p
        GROUP BY father_id, mother_id
      ) c ON (c.father_id = p1.ID OR c.mother_id = p1.ID)
      WHERE p1.name = ?
      AND p1.ID IN (?)
      GROUP BY p1.ID
      `,
      [decodeURI(req.params.name), req.session.visible_people_ids]
    );
    res.json(d);
  });

  app.post("/people/:name", async (req, res) => {
    let body = req.body;
    let name = decodeURI(req.params.name);

    // Get the person being edited to check their family_id
    await loadVisiblePeopleIds(req.session);
    let person = await db.query(
      "family_db",
      "select ID, family_id from people where name = ? and ID in (?)",
      [name, req.session.visible_people_ids]
    );

    if (person.length === 0) {
      return res.status(404).json({ error: "Person not found" });
    }

    let personFamilyId = person[0].family_id;

    // Check if user can edit this family
    if (!(await canEditFamily(req.session, personFamilyId))) {
      return res.status(403).json({ error: "You don't have edit permission for this family" });
    }

    // Get editable family_ids for relationship updates
    let editable_family_ids = await getEditableFamilyIds(req.session);

    // Handle relationship fields
    const relationshipFields = [
      "father_name",
      "mother_name",
      "children_names",
      "spouse_names",
    ];
    for (const key of relationshipFields) {
      if (body[key]) {
        if (key === "father_name") {
          db.query(
            "family_db",
            `UPDATE people SET father_id = (SELECT ID FROM people WHERE name = ? AND family_id IN (?)) WHERE name = ? AND family_id IN (?)`,
            [body.father_name, editable_family_ids, name, editable_family_ids]
          ).catch((err) => {
            console.error("Error updating father_id:", err);
          });
        }
        if (key === "mother_name") {
          db.query(
            "family_db",
            `UPDATE people SET mother_id = (SELECT ID FROM people WHERE name = ? AND family_id IN (?)) WHERE name = ? AND family_id IN (?)`,
            [body.mother_name, editable_family_ids, name, editable_family_ids]
          ).catch((err) => {
            console.error("Error updating father_id:", err);
          });
        }
        if (key == "spouse_names") {
          let spouseNames = body.spouse_names.split(",").map((s) => s.trim());
          for (const spouseName of spouseNames) {
            await db
              .query(
                "family_db",
                `UPDATE people SET spouse_id = (SELECT ID FROM people WHERE name = ? AND family_id IN (?)) WHERE name = ? AND family_id IN (?)`,
                [spouseName, editable_family_ids, name, editable_family_ids]
              )
              .catch((err) => {
                console.error("Error updating spouse_id:", err);
              });
          }
        }
        if (key == "children_names") {
          let childrenNames = body.children_names
            .split(",")
            .map((c) => c.trim());
          for (const childName of childrenNames) {
            await db
              .query(
                "family_db",
                `UPDATE people SET father_id = (SELECT ID FROM people WHERE name = ? AND family_id IN (?)) WHERE name = ? AND family_id IN (?)`,
                [childName, editable_family_ids, name, editable_family_ids]
              )
              .catch((err) => {
                console.error("Error updating child father_id:", err);
              });
          }
        }
      }
    }

    // Build SET clause dynamically from body, trimming values
    const entries = Object.entries(body)
      .filter(
        ([key, value]) =>
          !relationshipFields.includes(key) &&
          value !== "" &&
          value !== undefined
      )
      .map(([key, value]) => [
        key,
        typeof value === "string" ? value.trim() : value,
      ]);
    if (!entries.length) {
      return res.status(400).json({ error: "No fields to update." });
    }
    const updates = entries.map(([key]) => `${key} = ?`).join(", ");
    const updateValues = entries.map(([_, value]) => value);

    let sql = `
      UPDATE people
      SET ${updates}
      WHERE name = ?
      AND family_id IN (?)
    `;
    updateValues.push(name, editable_family_ids);

    try {
      await db.query("family_db", sql, updateValues);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/people", async (req, res) => {
    let body = req.body;

    if (!body.name) {
      return res.status(400).json({ error: "Name is required." });
    }

    if (!body.family_id) {
      return res.status(400).json({ error: "family_id is required." });
    }

    let family_id = body.family_id;

    // Check if user can edit this family
    if (!(await canEditFamily(req.session, family_id))) {
      return res.status(403).json({ error: "You don't have edit permission for this family" });
    }

    // Build columns and values for insert
    let columns = Object.keys(body);
    let values = Object.values(body);
    let placeholders = columns.map(() => "?").join(", ");

    let sql = `
    INSERT INTO people (${columns.join(", ")})
    VALUES (${placeholders})
  `;

    try {
      await db.query("family_db", sql, values);
      // Refresh session cache so new person is immediately visible
      await loadVisiblePeopleIds(req.session, false);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/permissions", async (req, res) => {
    let sd = req.session.sd;
    if (!sd) {
      let sdArr = await getSecurityDetails(req.session.google_data.email);
      sd = sdArr[0];
    }
    // Include family-specific permissions
    let familyPermissions = await getFamilyPermissions(req.session.google_data.email);
    res.json({ ...sd, family_permissions: familyPermissions });
  });

  app.post("/family/:id", async (req, res) => {
    let family_id = req.params.id;

    // Check if family name already exists
    let existing = await db.query(
      "family_db",
      "select family_id from owned_families where family_id = ?",
      [family_id]
    );
    if (existing.length > 0) {
      return res.status(400).json({ error: "A family with this name already exists. Please choose a unique name." });
    }

    try {
      let data = await db.query(
        "family_db",
        "insert into owned_families (email,family_id) VALUES (?,?)",
        [req.session.google_data.email, family_id]
      );
      // Refresh session caches so user can immediately edit their new family
      await loadFamilyIds(req.session, false);
      await loadVisiblePeopleIds(req.session, false);
      req.session.family_permissions = await getFamilyPermissions(req.session.google_data.email);
      res.json({ success: true, family_id });
      return;
    } catch (e) {
      res.status(500).json({ error: "Error Adding Family" });
      return;
    }
  });

  app.post("/roots/:familyId", async (req, res) => {
    let body = req.body;
    let familyId = req.params.familyId;

    // Check if user can edit this family
    if (!(await canEditFamily(req.session, familyId))) {
      return res.status(403).json({ error: "You don't have edit permission for this family" });
    }

    if (!body.father_id && !body.mother_id) {
      return res
        .status(400)
        .json({ error: "At least 1 ancestor must be specified" });
    }

    try {
      let data = await db.query(
        "family_db",
        "insert into roots (family_id,father_id,mother_id) values (?,?,?)",
        [familyId, body.father_id, body.mother_id]
      );
      return res.json({ success: true, data });
    } catch (e) {
      console.error("Error adding roots:", e);
      return res.status(500).json({ error: "Error adding roots: " + e.message });
    }
  });

  app.get("/family_ids", async (req, res) => {
    let email = req.session.google_data.email;
    let familyIds = await getFamilyIds(email);
    if (familyIds.length == 0) {
      return res.status(404).json({ error: "No family IDs found for user." });
    }
    return res.json(familyIds);
  });

  app.get("/getMyFamiliesRoots", async (req, res) => {
    await loadFamilyIds(req.session);
    let familyIds = req.session.family_ids;
    if (!familyIds || familyIds.length === 0) {
      return res.json([]);
    }
    let roots = await db.query(
      "family_db",
      `select o.family_id, p1.name ancestor1, p2.name ancestor2
      from owned_families o
      left join roots r on o.family_id = r.family_id
      left join people p1 on p1.id = r.father_id
      left join people p2 on p2.id = r.mother_id
      where o.family_id in (?)`,
      [familyIds]
    );
    return res.json(roots);
  });

  // Get user's permissions for all their families
  app.get("/my-family-permissions", async (req, res) => {
    let permissions = await getFamilyPermissions(req.session.google_data.email);
    return res.json(permissions);
  });

  // Get all editors/viewers for a family (only owners can see this)
  app.get("/family-permissions/:familyId", async (req, res) => {
    let familyId = req.params.familyId;
    let permissions = await getFamilyPermissions(req.session.google_data.email);

    if (permissions[familyId] !== "owner") {
      return res
        .status(403)
        .json({ error: "Only owners can view family permissions" });
    }

    let members = await db
      .query(
        "family_db",
        "select email, role from family_permissions where family_id = ?",
        [familyId]
      )
      .catch(() => []);

    return res.json(members);
  });

  // Grant permission to a user for a family (only owners can do this)
  app.post("/family-permissions/:familyId", async (req, res) => {
    let familyId = req.params.familyId;
    let { email, role } = req.body;

    if (!email || !role) {
      return res.status(400).json({ error: "email and role are required" });
    }

    if (role !== "editor" && role !== "viewer") {
      return res.status(400).json({ error: "role must be 'editor' or 'viewer'" });
    }

    let permissions = await getFamilyPermissions(req.session.google_data.email);

    if (permissions[familyId] !== "owner") {
      return res
        .status(403)
        .json({ error: "Only owners can grant family permissions" });
    }

    try {
      // Check if permission already exists
      let existing = await db.query(
        "family_db",
        "select * from family_permissions where email = ? and family_id = ?",
        [email, familyId]
      );

      if (existing.length > 0) {
        // Update existing permission
        await db.query(
          "family_db",
          "update family_permissions set role = ? where email = ? and family_id = ?",
          [role, email, familyId]
        );
      } else {
        // Insert new permission
        await db.query(
          "family_db",
          "insert into family_permissions (email, family_id, role) values (?, ?, ?)",
          [email, familyId, role]
        );
      }

      return res.json({ success: true, message: `Granted ${role} access to ${email}` });
    } catch (e) {
      console.error("Error granting permission:", e);
      return res.status(500).json({ error: "Failed to grant permission" });
    }
  });

  // Revoke permission from a user for a family (only owners can do this)
  app.delete("/family-permissions/:familyId/:email", async (req, res) => {
    let familyId = req.params.familyId;
    let email = decodeURIComponent(req.params.email);

    let permissions = await getFamilyPermissions(req.session.google_data.email);

    if (permissions[familyId] !== "owner") {
      return res
        .status(403)
        .json({ error: "Only owners can revoke family permissions" });
    }

    try {
      await db.query(
        "family_db",
        "delete from family_permissions where email = ? and family_id = ?",
        [email, familyId]
      );
      return res.json({ success: true, message: `Revoked access from ${email}` });
    } catch (e) {
      console.error("Error revoking permission:", e);
      return res.status(500).json({ error: "Failed to revoke permission" });
    }
  });

  // Get descendants of a specific person (for filtering)
  app.get("/descendants/:personId", async (req, res) => {
    let personId = parseInt(req.params.personId);
    if (isNaN(personId)) {
      return res.status(400).json({ error: "Invalid person ID" });
    }

    await loadVisiblePeopleIds(req.session);

    // Make sure the person is visible to the user
    if (!req.session.visible_people_ids.includes(personId)) {
      return res.status(403).json({ error: "You don't have access to this person" });
    }

    let descendantIds = await getDescendantIds(personId);
    return res.json(descendantIds);
  });
};

// Get all descendants of a person (including spouses of descendants)
async function getDescendantIds(personId) {
  let all_people = await db.query("family_db", "select * from people");

  let descendantIds = new Set([personId]);
  let toProcess = new Set([personId]);

  while (toProcess.size > 0) {
    let currentId = toProcess.values().next().value;
    toProcess.delete(currentId);

    // Find children (people whose father_id or mother_id is currentId)
    let children = all_people.filter(
      (p) => p.father_id === currentId || p.mother_id === currentId
    );

    for (let child of children) {
      if (!descendantIds.has(child.ID)) {
        descendantIds.add(child.ID);
        toProcess.add(child.ID);
      }
      // Also add the child's spouse(s)
      if (child.spouse_id && !descendantIds.has(child.spouse_id)) {
        descendantIds.add(child.spouse_id);
      }
    }

    // Also find anyone who has currentId as their spouse
    let spousesOf = all_people.filter((p) => p.spouse_id === currentId);
    for (let spouse of spousesOf) {
      if (!descendantIds.has(spouse.ID)) {
        descendantIds.add(spouse.ID);
      }
    }
  }

  return Array.from(descendantIds);
}

async function getSecurityDetails(email) {
  return await db.query(
    "family_db",
    `select * from security where email = ?;`,
    [email]
  );
}

async function addUser(email, role = "user") {
  return await db.query(
    "family_db",
    `insert into security (email,role) values (?,?);`,
    [email, role]
  );
}

async function incramentLogins(email) {
  return await db.query(
    "family_db",
    `update security set logins = logins + 1 where email = ?`,
    [email]
  );
}

// Get family-specific permissions for a user
// Returns { family_id: role } map where role is 'owner', 'editor', or 'viewer'
async function getFamilyPermissions(email) {
  // Get owned families (these are 'owner' permissions)
  let owned = await db.query(
    "family_db",
    "select family_id from owned_families where email = ?",
    [email]
  );

  // Get granted permissions from family_permissions table
  let granted = await db.query(
    "family_db",
    "select family_id, role from family_permissions where email = ?",
    [email]
  ).catch(() => []);

  let permissions = {};

  // Owners have full access
  for (let row of owned) {
    permissions[row.family_id] = "owner";
  }

  // Add granted permissions (owner status takes precedence)
  for (let row of granted) {
    if (!permissions[row.family_id]) {
      permissions[row.family_id] = row.role;
    }
  }

  return permissions;
}

// Check if user can edit a specific family
async function canEditFamily(session, familyId) {
  if (!session.family_permissions) {
    session.family_permissions = await getFamilyPermissions(
      session.google_data.email
    );
  }
  const role = session.family_permissions[familyId];
  return role === "owner" || role === "editor";
}

// Check if user can edit any of the given family_ids
async function canEditAnyFamily(session, familyIds) {
  if (!session.family_permissions) {
    session.family_permissions = await getFamilyPermissions(
      session.google_data.email
    );
  }
  return familyIds.some((fid) => {
    const role = session.family_permissions[fid];
    return role === "owner" || role === "editor";
  });
}

// Get list of family_ids the user can edit
async function getEditableFamilyIds(session) {
  if (!session.family_permissions) {
    session.family_permissions = await getFamilyPermissions(
      session.google_data.email
    );
  }
  return Object.entries(session.family_permissions)
    .filter(([_, role]) => role === "owner" || role === "editor")
    .map(([fid, _]) => fid);
}

async function getFamilyIds(email) {
  let all_people = await db.query("family_db", "select * from people");

  let person_id = all_people.find((p) => p.email === email)?.ID;

  // If user is not in people table, only check owned_families
  if (!person_id) {
    let owned_trees = await db.query(
      "family_db",
      "select family_id from owned_families where email = ?",
      [email]
    );
    return owned_trees.map((r) => r.family_id);
  }

  let spouse_ids = all_people.filter((p) => p.spouse_id == person_id);

  let all_ids = new Set([person_id, ...spouse_ids.map((p) => p.ID)]);

  let id_stack = new Set([person_id, ...spouse_ids.map((p) => p.ID)]);
  while (id_stack.size > 0) {
    let current_id = id_stack.values().next().value;
    id_stack.delete(current_id);

    let parents = all_people.filter((p) => p.ID === current_id);
    for (let parent of parents) {
      if (!all_ids.has(parent.ID)) {
        all_ids.add(parent.ID);
        id_stack.add(parent.ID);
      }
      if (parent.father_id && !all_ids.has(parent.father_id)) {
        all_ids.add(parent.father_id);
        id_stack.add(parent.father_id);
      }
      if (parent.mother_id && !all_ids.has(parent.mother_id)) {
        all_ids.add(parent.mother_id);
        id_stack.add(parent.mother_id);
      }
    }
  }

  let roots = await db.query(
    "family_db",
    "select family_id from roots where father_id in (?) or mother_id in (?)",
    [Array.from(all_ids), Array.from(all_ids)]
  );

  let owned_trees = await db.query(
    "family_db",
    "select family_id from owned_families where email = ?",
    [email]
  );

  let all_family_ids = roots.concat(owned_trees).map((r) => r.family_id);
  let unique_ids = [...new Set(all_family_ids)];

  return unique_ids;
}

async function getProfile(name) {}

// Given family_ids, get all root ancestor IDs, then traverse DOWN to find all descendants and their spouses
// Also includes all people in families the user owns or can edit
async function getVisiblePeopleIds(familyIds, email) {
  if (!familyIds || familyIds.length === 0) {
    return [];
  }

  let all_people = await db.query("family_db", "select * from people");

  let visibleIds = new Set();

  // First, add all people from families the user owns or has edit/view access to
  // This ensures owners can always see everyone in their families, even without roots
  if (email) {
    let permissions = await getFamilyPermissions(email);
    let accessibleFamilyIds = Object.entries(permissions)
      .map(([fid, _]) => fid);

    for (let person of all_people) {
      if (person.family_id && accessibleFamilyIds.includes(person.family_id)) {
        visibleIds.add(person.ID);
      }
    }
  }

  // Get roots for these family_ids
  let roots = await db.query(
    "family_db",
    "select father_id, mother_id from roots where family_id in (?)",
    [familyIds]
  );

  // Add root ancestors (convert to numbers since roots table stores as strings)
  for (let root of roots) {
    if (root.father_id) visibleIds.add(Number(root.father_id));
    if (root.mother_id) visibleIds.add(Number(root.mother_id));
  }

  // Traverse down: find all descendants
  let toProcess = new Set(visibleIds);
  while (toProcess.size > 0) {
    let currentId = toProcess.values().next().value;
    toProcess.delete(currentId);

    // Find children (people whose father_id or mother_id is currentId)
    let children = all_people.filter(
      (p) => p.father_id === currentId || p.mother_id === currentId
    );

    for (let child of children) {
      if (!visibleIds.has(child.ID)) {
        visibleIds.add(child.ID);
        toProcess.add(child.ID);
      }
      // Also add the child's spouse(s)
      if (child.spouse_id && !visibleIds.has(child.spouse_id)) {
        visibleIds.add(child.spouse_id);
      }
    }

    // Also find anyone who has currentId as their spouse
    let spousesOf = all_people.filter((p) => p.spouse_id === currentId);
    for (let spouse of spousesOf) {
      if (!visibleIds.has(spouse.ID)) {
        visibleIds.add(spouse.ID);
      }
    }
  }

  return Array.from(visibleIds);
}

async function loadFamilyIds(session, soft = true) {
  if (session.family_ids && soft) return;
  let familyIds = await getFamilyIds(session.google_data.email);
  session.family_ids = familyIds;
}

async function loadVisiblePeopleIds(session, soft = true) {
  if (session.visible_people_ids && soft) return;
  await loadFamilyIds(session, soft);
  session.visible_people_ids = await getVisiblePeopleIds(
    session.family_ids,
    session.google_data.email
  );
}

exports.onlogin = async function (session) {
  if (session.google_data) {
    let sd = await getSecurityDetails(session.google_data.email);
    if (sd.length == 0) {
      await addUser(session.google_data.email);
      sd = await getSecurityDetails(session.google_data.email);
    } else {
      incramentLogins(session.google_data.email);
    }
    session.sd = sd[0];
    await loadFamilyIds(session);
  }
};

/* session.google_data

{
  iss: 'https://accounts.google.com',
  azp: '1016767921529-7km6ac8h3cud3256dqjqha6neiufn2om.apps.googleusercontent.com',
  aud: '1016767921529-7km6ac8h3cud3256dqjqha6neiufn2om.apps.googleusercontent.com',
  sub: '103589682456946370010',
  email: 'southwickmatthias@gmail.com',
  email_verified: true,
  nbf: 1723080904,
  name: 'Matthias Southwick',
  picture: 'https://lh3.googleusercontent.com/a/ACg8ocLjdsGc7uC2mmthGuvrPpmV2AFT2U_EdiXxon8tX5QwbR7m8VYkeA=s96-c',
  given_name: 'Matthias',
  family_name: 'Southwick',
  iat: 1723081204,
  exp: 1723084804,
  jti: 'ad27c4b889a0eb48b6ce4cf6690fca739892ca88'
}

*/
