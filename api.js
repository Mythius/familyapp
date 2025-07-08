const db = require("./db.js");
require("dotenv").config();
const h = "127.0.0.1";

db.dbServer.host = process.env.DB;
db.dbServer.user = process.env.DB_USER;
db.dbServer.password = process.env.DB_PASS;
db.ssh_config.password = process.env.SSH_PASS;
db.setQueryMode(process.env.DB_TYPE || "ssh");

console.log(db);
console.log(process.env.USER);


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
      "127.0.0.1",
      "family_db",
      `select * from people where family_id in (select distinct family_id from people where email = '${email}')`
    ).then((data) => {
      res.json(data);
    });
  });

  app.get("/people/:name", async (req, res) => {
    let email = req.session.google_data.email;
    let d = await db.query(
      h,
      "family_db",
      `select * from people where name = '${decodeURI(
        req.params.name
      )}' and family_id in (select distinct family_id from people where email = '${email}')`
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

    // Build SET clause dynamically from body
    let updates = Object.entries(body).filter(e=>e.value!='')
      .map(([key, value]) => `${key} = '${value}'`)
      .join(", ");

    let sql = `
    UPDATE people
    SET ${updates}
    WHERE name = '${name}'
      AND family_id IN (
        SELECT DISTINCT family_id FROM people WHERE email = '${email}'
      )
  `;

    try {
      await db.query(h, "family_db", sql);
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
      h,
      "family_db",
      `SELECT DISTINCT family_id FROM people WHERE email = '${email}'`
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
      await db.query(h, "family_db", sql, values);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/permissions", async (req, res) => {
    if(req.session.sd) return res.json(req.session.sd);
    let sd = await getSecurityDetails(req.session.google_data.email);
    res.json(sd[0]);
  });
};

async function getSecurityDetails(email) {
  return await db.query(
    h,
    "family_db",
    `select * from security where email = "${email}";`
  );
}

async function addUser(email, role = "user") {
  return await db.query(
    h,
    "family_db",
    `insert into security (email,role) values ("${email}","${role}");`
  );
}

async function incramentLogins(email) {
  return await db.query(
    h,
    "family_db",
    `update security set logins = logins + 1 where email = "${email}"`
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
