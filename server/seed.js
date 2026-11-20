"use strict";
const dbm = require("./db");
dbm.open();
dbm.migrate();
const created = dbm.seed();
console.log(created ? "seeded" : "already seeded", dbm.dbPath);
console.log("owner@ovem.local / admin@ovem.local / editor@ovem.local / viewer@ovem.local / owner@beichen.local");
console.log("password:", dbm.SEED_PASSWORD);
dbm.close();
