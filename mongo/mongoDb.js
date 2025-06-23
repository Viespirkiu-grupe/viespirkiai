import { MongoClient } from "mongodb";
import config from "../utils/config.js";

const client = new MongoClient(config.mongoDb);
await client.connect();

const db = client.db(config.mongoDBName);

export const viespirkiai = db.collection(config.mongoDbCollection);
