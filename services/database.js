import { databases, DATABASE_ID, COLLECTIONS } from "../config/appwrite.js";
import { ID, Query } from "node-appwrite";

class DatabaseService {
  async createUser(telegramId, firstName, lastName = "", username = "") {
    try {
      if (!telegramId || !firstName)
        throw new Error("telegramId and firstName are required");

      const existing = await this.getUserByTelegramId(telegramId);
      if (existing) {
        await this.ensureUserWallet(existing.$id);
        return existing;
      }

      const user = await databases.createDocument(
        DATABASE_ID,
        COLLECTIONS.USERS,
        ID.unique(),
        {
          telegramId: telegramId.toString(),
          firstName,
          lastName,
          username,
          createdAt: new Date().toISOString(),
        }
      );

      await this.ensureUserWallet(user.$id);
      return user;
    } catch (error) {
      console.error("CreateUser Error:", error);
      throw error;
    }
  }

  async ensureUserWallet(userId) {
    try {
      if (!userId) throw new Error("userId is required");
      const wallet = await this.getUserWallet(userId);
      if (!wallet) {
        console.warn(
          `Wallet not found for user ${userId}. Creating a new one.`
        );
        return await databases.createDocument(
          DATABASE_ID,
          COLLECTIONS.WALLETS,
          ID.unique(),
          {
            userId,
            balance: 0,
            createdAt: new Date().toISOString(),
          }
        );
      }
      return wallet;
    } catch (error) {
      console.error("ensureUserWallet Error:", error);
      throw error;
    }
  }

  async getUserByTelegramId(telegramId) {
    try {
      if (!telegramId) throw new Error("telegramId is required");
      const response = await databases.listDocuments(
        DATABASE_ID,
        COLLECTIONS.USERS,
        [Query.equal("telegramId", telegramId.toString())]
      );
      return response.documents[0] || null;
    } catch (error) {
      console.error("getUserByTelegramId Error:", error);
      throw error;
    }
  }

  async getUserWallet(userId) {
    try {
      if (!userId) throw new Error("userId is required");
      const response = await databases.listDocuments(
        DATABASE_ID,
        COLLECTIONS.WALLETS,
        [Query.equal("userId", userId)]
      );
      return response.documents[0] || null;
    } catch (error) {
      console.error("getUserWallet Error:", error);
      throw error;
    }
  }

  async updateWalletBalance(userId, amount, type = "credit") {
    try {
      if (!userId || isNaN(amount) || amount < 0) {
        throw new Error("Invalid userId or amount");
      }
      const wallet = await this.getUserWallet(userId);
      if (!wallet) throw new Error("Wallet not found");

      const currentBalance = parseFloat(wallet.balance);
      const amt = parseFloat(amount);
      const newBalance =
        type === "credit" ? currentBalance + amt : currentBalance - amt;

      if (newBalance < 0) throw new Error("Insufficient balance");

      const formattedBalance = parseFloat(newBalance.toFixed(2));
      return await databases.updateDocument(
        DATABASE_ID,
        COLLECTIONS.WALLETS,
        wallet.$id,
        { balance: formattedBalance }
      );
    } catch (error) {
      console.error("updateWalletBalance Error:", error);
      throw error;
    }
  }

  async createTransaction(
    userId,
    type,
    amount,
    details = {},
    status = "pending"
  ) {
    try {
      // Validate required fields
      if (!userId || !amount || !type) {
        throw new Error(
          "Invalid transaction data: Missing userId, amount, or type"
        );
      }

      // Extract reference from details object
      const reference = details.reference;
      if (!reference) {
        throw new Error(
          "Transaction 'reference' is required inside details object"
        );
      }

      // Construct payload for transaction document
      const payload = {
        userId,
        type,
        amount: parseFloat(amount.toFixed(2)),
        reference, // top-level reference field
        details: JSON.stringify(details),
        status,
        createdAt: new Date().toISOString(),
      };

      // Create and return document
      return await databases.createDocument(
        DATABASE_ID,
        COLLECTIONS.TRANSACTIONS,
        ID.unique(),
        payload
      );
    } catch (error) {
      console.error("Transaction Creation Error:", error);
      throw error;
    }
  }

  async updateTransaction(transactionId, updates) {
    try {
      if (!transactionId || !updates)
        throw new Error("transactionId and updates are required");

      return await databases.updateDocument(
        DATABASE_ID,
        COLLECTIONS.TRANSACTIONS,
        transactionId,
        updates
      );
    } catch (error) {
      console.error("Transaction Update Error:", error);
      throw error;
    }
  }

  async getUserTransactions(userId, limit = 10) {
    try {
      if (!userId) throw new Error("userId is required");

      const response = await databases.listDocuments(
        DATABASE_ID,
        COLLECTIONS.TRANSACTIONS,
        [
          Query.equal("userId", userId),
          Query.orderDesc("createdAt"),
          Query.limit(limit),
        ]
      );
      return response.documents;
    } catch (error) {
      console.error("getUserTransactions Error:", error);
      throw error;
    }
  }

  async findTransactionByReference(reference) {
    try {
      const res = await databases.listDocuments(
        DATABASE_ID,
        COLLECTIONS.TRANSACTIONS,
        [Query.equal("reference", reference)]
      );
      return res.documents[0] || null;
    } catch (err) {
      console.error("findTransactionByReference Error:", err);
      throw err;
    }
  }
}

export default DatabaseService;