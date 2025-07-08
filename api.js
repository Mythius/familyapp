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

  app.get("/people", (req, res) => {
    let email = req.session.google_data.email;

    db.queryToCSV(
      "family_db",
      "select * from people where family_id in (select distinct family_id from people where email = ?)",
      [email]
    ).then((data) => {
      res.json(data);
    });
  });

  app.get("/people/:name", async (req, res) => {
    let email = req.session.google_data.email;
    let d = await db.query(
      "family_db",
      `select p1.*,
        p2.name father_name,
        p2.ID father_id,
        p3.name mother_name,
        p3.ID mother_id,
        s.names spouse_names,
        s.IDs spouse_ids,
        c.names children_names,
        c.IDs children_ids
      from people p1 
      left join people p2 on p1.father_id = p2.ID
      left join people p3 on p1.mother_id = p3.ID
      left join (
        select
          father_id, mother_id,
          group_concat(people.name order by people.birthday asc) names,
          group_concat(people.ID order by people.birthday asc) IDs
        from people 
          group by father_id, mother_id
      ) c on (c.father_id = p1.ID or c.mother_id = p1.ID)
      left join (
        select
          spouse_id,
          group_concat(people.name order by people.marriage_date asc) names,
          group_concat(people.ID order by people.marriage_date asc) IDs
        from people 
          group by spouse_id
      ) s on (s.spouse_id = p1.Id)
      where p1.name = ?
      and p1.family_id in (select distinct family_id from people where email = ?)`,
      [decodeURI(req.params.name), email]
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
            `UPDATE people SET father_id = (SELECT ID FROM people WHERE name = ? AND family_id IN (SELECT DISTINCT family_id FROM people WHERE email = ?)) WHERE name = ? AND family_id IN (SELECT DISTINCT family_id FROM people WHERE email = ?)`,
            [body.father_name, email, name, email]
          ).catch((err) => {
            console.error("Error updating father_id:", err);
          });
        }
        if (key === "mother_name") {
          db.query(
            "family_db",
            `UPDATE people SET mother_id = (SELECT ID FROM people WHERE name = ? AND family_id IN (SELECT DISTINCT family_id FROM people WHERE email = ?)) WHERE name = ? AND family_id IN (SELECT DISTINCT family_id FROM people WHERE email = ?)`,
            [body.mother_name, email, name, email]
          ).catch((err) => {
            console.error("Error updating father_id:", err);
          });
        }
        if(key == "spouse_names") {
          let spouseNames = body.spouse_names.split(",").map(s => s.trim());
          for (const spouseName of spouseNames) {
            await db.query(
              "family_db",
              `UPDATE people SET spouse_id = (SELECT ID FROM people WHERE name = ? AND family_id IN (SELECT DISTINCT family_id FROM people WHERE email = ?)) WHERE name = ? AND family_id IN (SELECT DISTINCT family_id FROM people WHERE email = ?)`,
              [spouseName, email, name, email]
            ).catch((err) => {
              console.error("Error updating spouse_id:", err);
            });
          }
        }
        if(key == "children_names") {
          let childrenNames = body.children_names.split(",").map(c => c.trim());
          for (const childName of childrenNames) {
            await db.query(
              "family_db",
              `UPDATE people SET father_id = (SELECT ID FROM people WHERE name = ? AND family_id IN (SELECT DISTINCT family_id FROM people WHERE email = ?)) WHERE name = ? AND family_id IN (SELECT DISTINCT family_id FROM people WHERE email = ?)`,
              [childName, email, name, email]
            ).catch((err) => {
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
      AND family_id IN (
        SELECT DISTINCT family_id FROM people WHERE email = ?
      )
    `;
    updateValues.push(name, email);

    try {
      await db.query("family_db", sql, updateValues);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/people", async (req, res) => {
    let body = req.session.body;
    let email = req.session.google_data.email;

    if (req.session.sd.role != "admin") {
      return res.status(403).json({ error: "Access Denied" });
    }

    // Get family_id for the current user
    let families = await db.query(
      "family_db",
      `SELECT DISTINCT family_id FROM people WHERE email = ?`,
      [email]
    );

    if (!families.length) {
      return res.status(400).json({ error: "No family found for user." });
    }

    let family_id = families[0].family_id;

    // Build columns and values for insert
    let columns = Object.keys(body).concat("family_id");
    let values = Object.values(body).concat(family_id);
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

async function getProfile(name) {}

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
