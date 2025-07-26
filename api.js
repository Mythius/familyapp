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
    let email = req.session.google_data.email;

    await loadFamilyIds(req.session);

    db.queryToCSV("family_db", "select * from people where family_id in (?)", [
      req.session.family_ids,
    ]).then((data) => {
      res.json(data);
    });
  });

  app.get("/people/:name", async (req, res) => {
    let email = req.session.google_data.email;
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
        c.names AS children_names,
        c.IDs AS children_ids
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
      AND p1.family_id IN (?)
      GROUP BY p1.ID
      `,
      [decodeURI(req.params.name), req.session.family_ids]
    );
    res.json(d);
  });

  app.post("/people/:name", async (req, res) => {
    let body = req.body;
    let email = req.session.google_data.email;
    let name = decodeURI(req.params.name);

    if (req.session.sd.role != "admin") {
      return res.status(403).json({ error: "Access Denied" });
    }

    let family_ids = req.session.family_ids;

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
            [body.father_name, family_ids, name, family_ids]
          ).catch((err) => {
            console.error("Error updating father_id:", err);
          });
        }
        if (key === "mother_name") {
          db.query(
            "family_db",
            `UPDATE people SET mother_id = (SELECT ID FROM people WHERE name = ? AND family_id IN (?)) WHERE name = ? AND family_id IN (?)`,
            [body.mother_name, family_ids, name, family_ids]
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
                [spouseName, family_ids, name, family_ids]
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
                [childName, family_ids, name, family_ids]
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
    updateValues.push(name, family_ids);

    try {
      await db.query("family_db", sql, updateValues);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/people", async (req, res) => {
    let body = req.body;
    let email = req.session.google_data.email;

    if (req.session.sd.role != "admin") {
      return res.status(403).json({ error: "Access Denied" });
    }

    if (!body.name) {
      return res.status(400).json({ error: "Name is required." });  
    }

    if (!body.family_id) {
      return res.status(400).json({ error: "family_id is required." });
    }

    let family_id = body.family_id;

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
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/permissions", async (req, res) => {
    if (req.session.sd) return res.json(req.session.sd);
    let sd = await getSecurityDetails(req.session.google_data.email);
    res.json(sd[0]);
  });

  app.get("/roots", async (req, res) => {
    let roots = await db.query(
      "family_db",
      "select family_id from user_roots where email = ?",
      [req.session.google_data.email]
    );
    if (roots.length == 0) {
      return res.status(404).json({ error: "No roots found for user." });
    }
    return res.json(roots.map((r) => r.family_id));
  });

  app.get("/family_ids", async (req, res) => {
    let email = req.session.google_data.email;
    let familyIds = await getFamilyIds(email);
    if (familyIds.length == 0) {
      return res.status(404).json({ error: "No family IDs found for user." });
    }
    return res.json(familyIds);
  });
};

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

async function getFamilyIds(email) {
  let all_people = await db.query("family_db", "select * from people");

  let person_id = all_people.find((p) => p.email === email)?.ID;

  let spouse_ids = all_people.filter((p) => p.spouse_id === person_id);

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
    "select family_id from user_roots where email = ?",
    [email]
  );

  let all_family_ids = roots.concat(owned_trees).map((r) => r.family_id);
  let unique_ids = [...new Set(all_family_ids)];

  return unique_ids;
}

async function getProfile(name) {}

async function loadFamilyIds(session) {
  if (session.family_ids) return;
  let familyIds = await getFamilyIds(session.google_data.email);
  session.family_ids = familyIds;
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
    loadFamilyIds(session);
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
