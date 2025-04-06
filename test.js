const db = require('./db.js');
require('dotenv').config();

db.dbServer.host = process.env.DB;
db.dbServer.user = process.env.USER;
db.dbServer.password = process.env.PASS;
db.ssh_config.password = process.env.SSH_PASS;
db.setQueryMode('ssh');

// const path = "C:\\Users\\South\\Downloads\\Joseph Albert & Elda Whiting Brown Family Contact List - Geraldine.csv";

async function main(){
    // db.uploadCSV(path,'127.0.0.1','family_db','people')
}


main();