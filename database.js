import { MongoClient } from "mongodb";
import config from "./utils/config.js";

const client = new MongoClient(config.mongoDb);
await client.connect();

const db = client.db(config.mongoDBName);

export const viespirkiai = db.collection(config.mongoDbCollection);

import { createConnection, createPool } from 'mysql2/promise';

export const mysql = createPool({
  host: config.mysqlHost,
  user: config.mysqlUser,
  password: config.mysqlPassword,
  database: config.mysqlDatabase,
  port: config.mysqlPort,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
})

