import config from "../utils/config.js";
import { createPool } from 'mysql2/promise';

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