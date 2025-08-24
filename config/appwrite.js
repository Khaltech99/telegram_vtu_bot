// config/appwrite.js
import { Client, Databases, Account, Users } from "node-appwrite";

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT)
  .setProject(process.env.APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);

const databases = new Databases(client);
const users = new Users(client);
const account = new Account(client);

const DATABASE_ID = process.env.APPWRITE_DATABASE_ID;
const COLLECTIONS = {
  USERS: "6888bb550004b0f56b89",
  TRANSACTIONS: "6888bbfe002d1b0dee7c",
  WALLETS: "6888f8b80021f9a4a787",
};

export { client, databases, users, account, DATABASE_ID, COLLECTIONS };
