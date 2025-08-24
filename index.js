import "dotenv/config";
import TelegramBot from "node-telegram-bot-api";
import VTPassService from "./services/vtpass.js";
import PaystackService from "./services/paystack.js";
import DatabaseService from "./services/database.js";
import Bottleneck from "bottleneck";
import express from "express";
import bodyParser from "body-parser";
import crypto from "crypto";

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
const vtpass = new VTPassService();
const paystack = new PaystackService();
const db = new DatabaseService();
const limiter = new Bottleneck({ minTime: 1000 }); // 1 request/sec

const userSessions = new Map();
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

const app = express();
app.use(bodyParser.json({ verify: (req, res, buf) => (req.rawBody = buf) }));
const WEBHOOK_PATH = "/paystack/webhook";
const WEBHOOK_PORT = process.env.PORT || 3000;

const isTestMode =
  process.env.VTPASS_TEST_MODE === "true" ||
  process.env.PAYSTACK_TEST_MODE === "true";

// Periodic session cleanup
setInterval(() => {
  const now = Date.now();
  for (const [chatId, session] of userSessions) {
    if (now - session.lastActivity > SESSION_TIMEOUT) {
      userSessions.delete(chatId);
    }
  }
}, 60 * 1000);

// ✅ Paystack Webhook Handler
// ✅ Fixed Paystack Webhook Handler
app.post(
  WEBHOOK_PATH,
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const secret = process.env.PAYSTACK_SECRET_KEY;

      // 🔐 Verify signature from raw buffer
      const hash = crypto
        .createHmac("sha512", secret)
        .update(req.body)
        .digest("hex");

      if (hash !== req.headers["x-paystack-signature"]) {
        console.error("❌ Invalid Paystack webhook signature");
        return res.status(401).send("Invalid signature");
      }

      // 👇 Parse JSON payload from raw buffer
      const payload = JSON.parse(req.body.toString("utf8"));
      const { event, data } = payload;

      if (event !== "charge.success") {
        return res.status(200).send("Event ignored");
      }

      const reference = data.reference;
      const amount = data.amount / 100; // Convert from kobo
      const userId = reference.split("_")[1]; // Format: FUND_<userId>_<timestamp>

      console.log("🔔 Webhook received for reference:", reference);

      // ✅ Fetch user
      const user = await db.getUserByTelegramId(userId);
      if (!user) {
        console.error("❌ User not found for telegramId:", userId);
        return res.status(400).send("User not found");
      }

      // ✅ Check if transaction already exists and succeeded
      const existingTransaction = await db.findTransactionByReference(
        reference
      );
      if (existingTransaction?.status === "success") {
        console.log("🛑 Duplicate webhook for reference:", reference);
        return res.status(200).send("Transaction already processed");
      }

      // ✅ Verify payment with Paystack
      const verification = await paystack.verifyPayment(reference);
      if (verification.data.status !== "success") {
        console.error("❌ Payment verification failed:", reference);
        return res.status(400).send("Payment not successful");
      }

      // ✅ Credit wallet
      await db.updateWalletBalance(user.$id, amount, "credit");

      // 🔧 FIX: Save or update transaction properly
      if (existingTransaction) {
        // Update existing transaction
        await db.updateTransaction(existingTransaction.$id, {
          status: "success",
        });
      } else {
        // Create new transaction with correct parameters
        await db.createTransaction(
          user.$id, // userId
          "credit", // type
          amount, // amount
          {
            reference, // details object with reference
            source: "Paystack",
          },
          "success" // status
        );
      }

      // ✅ Notify user
      await bot.sendMessage(
        user.telegramId,
        `✅ Wallet funded successfully with ₦${amount.toFixed(2)}!`
      );

      console.log(`✅ Wallet funded: ₦${amount} for user ${user.$id}`);
      return res.status(200).send("Webhook processed");
    } catch (error) {
      console.error("🔥 Webhook Handler Error:", error);
      return res.status(500).send("Internal server error");
    }
  }
);

// Fallback Polling for Test Mode
// Fallback Polling for Test Mode - FIXED VERSION
async function pollPaymentStatus(
  reference,
  userId,
  amount,
  chatId,
  maxAttempts = 30,
  interval = 10000
) {
  let attempts = 0;
  const intervalId = setInterval(async () => {
    try {
      const verification = await paystack.verifyPayment(reference);
      if (verification.data.status === "success") {
        clearInterval(intervalId);
        const user = await db.getUserByTelegramId(userId);
        const transactions = await db.getUserTransactions(user.$id, 10);

        // 🔧 FIX: Properly parse details and find transaction by reference
        const transaction = transactions.find((t) => {
          try {
            // Parse details if it's a JSON string, otherwise use as object
            const details =
              typeof t.details === "string" ? JSON.parse(t.details) : t.details;
            return details?.reference === reference;
          } catch (parseError) {
            console.error("Error parsing transaction details:", parseError);
            return false;
          }
        });

        if (transaction && transaction.status === "success") {
          console.log("🛑 Transaction already processed:", reference);
          return; // Already processed
        }

        // 🔧 FIX: Credit wallet and update transaction status
        await db.updateWalletBalance(user.$id, amount, "credit");

        if (transaction) {
          await db.updateTransaction(transaction.$id, { status: "success" });
          console.log("✅ Transaction updated to success:", transaction.$id);
        } else {
          // 🔧 FIX: Create new transaction if not found
          await db.createTransaction(
            user.$id,
            "credit",
            amount,
            {
              reference, // This is already correct since 'reference' is passed in
              source: "Paystack",
              method: "polling",
            },
            "success"
          );
          console.log("✅ New transaction created for reference:", reference);
        }

        await bot.sendMessage(
          chatId,
          `✅ Wallet funded successfully with ₦${amount.toFixed(2)}!`
        );
        userSessions.delete(chatId);
        console.log(
          `✅ Polling completed: ₦${amount} credited to user ${userId}`
        );
      } else if (verification.data.status === "failed") {
        clearInterval(intervalId);
        await bot.sendMessage(chatId, "❌ Payment failed. Please try again.");
        userSessions.delete(chatId);
        console.log(`❌ Payment failed for reference: ${reference}`);
      } else {
        // Payment still pending, continue polling
        console.log(
          `⏳ Payment still pending for reference: ${reference} (attempt ${
            attempts + 1
          })`
        );
      }
    } catch (error) {
      console.error("Polling Error:", error);

      // 🔧 FIX: Handle specific error cases
      if (error.message.includes("Payment verification failed")) {
        console.warn(
          `⚠️ Verification failed for ${reference}, continuing to poll...`
        );
      }
    }

    attempts++;
    if (attempts >= maxAttempts) {
      clearInterval(intervalId);
      await bot.sendMessage(
        chatId,
        "❌ Payment verification timed out. Please contact support if payment was successful."
      );
      userSessions.delete(chatId);
      console.log(
        `⏰ Polling timed out for reference: ${reference} after ${maxAttempts} attempts`
      );
    }
  }, interval);
}

const SUPPORTED_NETWORKS = {
  MTN: { name: "MTN", airtime_code: "mtn", data_code: "mtn-data" },
  GLO: { name: "Glo", airtime_code: "glo", data_code: "glo-data" },
  AIRTEL: { name: "Airtel", airtime_code: "airtel", data_code: "airtel-data" },
  "9MOBILE": {
    name: "9mobile",
    airtime_code: "etisalat",
    data_code: "etisalat-data",
  },
};

const SUPPORTED_ELECTRICITY_PROVIDERS = {
  "eko-electric": { name: "Eko Electric" },
  "kano-electric": { name: "Kano Electric" },
  "portharcourt-electric": { name: "Port Harcourt Electric" },
};

const SUPPORTED_TV_PROVIDERS = {
  dstv: { name: "DSTV", code: "dstv" },
  gotv: { name: "GOTV", code: "gotv" },
  startimes: { name: "StarTimes", code: "startimes" },
};

function getNetworkKeyboard(type) {
  const networks = Object.values(SUPPORTED_NETWORKS);
  const buttons = [];

  for (let i = 0; i < networks.length; i += 2) {
    const row = networks.slice(i, i + 2).map((network) => ({
      text: network.name,
      callback_data: `${type}_network_${network.airtime_code}`,
    }));
    buttons.push(row);
  }

  // Add Cancel button as last row
  buttons.push([{ text: "❌ Cancel", callback_data: "cancel_operation" }]);

  return { inline_keyboard: buttons };
}

function getElectricityProviderKeyboard() {
  const providers = Object.entries(SUPPORTED_ELECTRICITY_PROVIDERS);
  const buttons = [];

  for (let i = 0; i < providers.length; i += 2) {
    const row = providers.slice(i, i + 2).map(([code, provider]) => ({
      text: provider.name,
      callback_data: `electricity_provider_${code}`,
    }));
    buttons.push(row);
  }

  // Add Cancel button as last row
  buttons.push([{ text: "❌ Cancel", callback_data: "cancel_operation" }]);

  return { inline_keyboard: buttons };
}

function getTvProviderKeyboard() {
  const providers = Object.entries(SUPPORTED_TV_PROVIDERS);
  const buttons = [];

  for (let i = 0; i < providers.length; i += 2) {
    const row = providers.slice(i, i + 2).map(([code, provider]) => ({
      text: provider.name,
      callback_data: `tv_provider_${code}`,
    }));
    buttons.push(row);
  }

  // Add Cancel button as last row
  buttons.push([{ text: "❌ Cancel", callback_data: "cancel_operation" }]);

  return { inline_keyboard: buttons };
}

function getCancelKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "❌ Cancel", callback_data: "cancel_operation" }],
    ],
  };
}

// Bot handlers
bot.onText(
  /\/start(?: (.+))?/,
  limiter.wrap(async (msg, match) => {
    const chatId = msg.chat.id;
    const user = msg.from;
    const param = match[1]; // Gets whatever comes after "/start"

    try {
      // Create user if not already in DB
      await db.createUser(
        user.id,
        user.first_name,
        user.last_name || "",
        user.username || ""
      );

      // If redirected from Paystack, show success message
      if (param === "wallet_funded") {
        await bot.sendMessage(
          chatId,
          `✅ Payment complete! Your wallet will reflect the balance shortly.`
        );
      }

      const testModeWarning = isTestMode
        ? `
🧪 TEST MODE ACTIVE 🧪
This bot is running in test mode. No real money will be charged and no actual services will be delivered.
━━━━━━━━━━━━━━━━━━━━━━
`
        : "";

      const welcomeMessage = `${testModeWarning}
🎉 Welcome to VTU Bot Created by Azeez! 🎉

Hi ${user.first_name}! I'm your personal VTU assistant. Here's what I can help you with:

💳 Buy Airtime - Top up your phone  
📱 Buy Data - Get internet bundles  
💡 Pay Electricity - Pay your bills  
📺 Pay TV - Subscribe to cable TV  
💰 Fund Wallet - Add money via Paystack  
📊 Check Balance - View wallet balance  
📜 Transaction History - See past transactions  

Use the menu below to get started! 👇
    `;

      await bot.sendMessage(chatId, welcomeMessage, {
        reply_markup: {
          keyboard: [
            ["💳 Buy Airtime", "📱 Buy Data"],
            ["💡 Pay Electricity", "📺 Pay TV"],
            ["💰 Fund Wallet", "📊 Check Balance"],
            ["📜 Transaction History", "❓ Help"],
          ],
          resize_keyboard: true,
          one_time_keyboard: false,
        },
      });
    } catch (error) {
      console.error("Start command error:", error);
      await bot.sendMessage(
        chatId,
        "❌ Something went wrong. Please try again."
      );
    }
  })
);

bot.onText(
  /\/test/,
  limiter.wrap(async (msg) => {
    const chatId = msg.chat.id;
    if (!isTestMode) {
      return bot.sendMessage(
        chatId,
        "❌ Test commands are only available in test mode."
      );
    }

    const testMessage = `
🧪 TEST MODE COMMANDS 🧪

Available test scenarios:
• /test_airtime - Test airtime purchase
• /test_data - Test data purchase
• /test_electricity - Test electricity payment
• /test_tv - Test TV subscription
• /test_payment - Test payment flow
• /test_error - Test error handling

Note: These commands simulate transactions without real money or service delivery.
  `;
    await bot.sendMessage(chatId, testMessage);
  })
);

bot.onText(
  /\/cancel/,
  limiter.wrap(async (msg) => {
    const chatId = msg.chat.id;
    userSessions.delete(chatId);
    await bot.sendMessage(chatId, "❌ Current operation cancelled.", {
      reply_markup: {
        keyboard: [
          ["💳 Buy Airtime", "📱 Buy Data"],
          ["💡 Pay Electricity", "📺 Pay TV"],
          ["💰 Fund Wallet", "📊 Check Balance"],
          ["📜 Transaction History", "❓ Help"],
        ],
        resize_keyboard: true,
        one_time_keyboard: false,
      },
    });
  })
);

bot.on(
  "callback_query",
  limiter.wrap(async (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;

    if (data === "cancel_operation") {
      userSessions.delete(chatId);
      await bot.answerCallbackQuery(query.id);
      await bot.editMessageText("❌ Operation cancelled.", {
        chat_id: chatId,
        message_id: query.message.message_id,
      });
      return;
    }
    if (!userSessions.has(chatId)) {
      userSessions.set(chatId, { lastActivity: Date.now() });
    }
    const session = userSessions.get(chatId);
    session.lastActivity = Date.now();

    try {
      await bot.answerCallbackQuery(query.id);

      if (data.startsWith("airtime_network_")) {
        const networkCode = data.replace("airtime_network_", "");
        const selectedNetwork = Object.values(SUPPORTED_NETWORKS).find(
          (net) => net.airtime_code === networkCode
        );
        if (!selectedNetwork) {
          return bot.sendMessage(
            chatId,
            "❌ Invalid network selected. Please try again."
          );
        }
        session.airtimeNetwork = selectedNetwork;
        session.stage = "awaiting_airtime_amount";
        await bot.editMessageText(
          `Selected Network: *${selectedNetwork.name}*\n\nEnter airtime amount:`,
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: "Markdown",
          }
        );
        return;
      }

      if (data.startsWith("data_network_")) {
        const networkCode = data.replace("data_network_", "");
        const selectedNetwork = Object.values(SUPPORTED_NETWORKS).find(
          (net) => net.airtime_code === networkCode
        );
        if (!selectedNetwork) {
          return bot.sendMessage(
            chatId,
            "❌ Invalid network selected. Please try again."
          );
        }
        session.dataNetwork = selectedNetwork;
        session.stage = "awaiting_data_phone";
        await bot.editMessageText(
          `Selected Network: *${selectedNetwork.name}*\n\n📞 Enter phone number for data:`,
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: "Markdown",
          }
        );
        return;
      }

      if (data.startsWith("electricity_provider_")) {
        const providerCode = data.replace("electricity_provider_", "");
        const selectedProvider = SUPPORTED_ELECTRICITY_PROVIDERS[providerCode];
        if (!selectedProvider) {
          return bot.sendMessage(
            chatId,
            "❌ Invalid provider selected. Please try again."
          );
        }
        session.electricityProvider = {
          code: providerCode,
          ...selectedProvider,
        };
        session.stage = "awaiting_meter_number";
        await bot.editMessageText(
          `Selected Provider: *${selectedProvider.name}*\n\n🔌 Enter your meter number:`,
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: "Markdown",
          }
        );
        return;
      }

      if (data.startsWith("tv_provider_")) {
        const providerCode = data.replace("tv_provider_", "");
        const selectedProvider = SUPPORTED_TV_PROVIDERS[providerCode];
        if (!selectedProvider) {
          return bot.sendMessage(
            chatId,
            "❌ Invalid provider selected. Please try again."
          );
        }
        session.tvProvider = { code: providerCode, ...selectedProvider };
        session.stage = "awaiting_card_number";
        await bot.editMessageText(
          `Selected Provider: *${selectedProvider.name}*\n\n📺 Enter Smart Card Number:`,
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: "Markdown",
          }
        );
        return;
      }
    } catch (err) {
      console.error("Callback Query Handler Error:", err);
      await bot.sendMessage(
        chatId,
        "❌ Something went wrong while processing your selection."
      );
    }
  })
);

bot.on(
  "message",
  limiter.wrap(async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text?.trim();
    const userId = msg.from.id;

    if (
      !text ||
      msg.callback_query ||
      text.startsWith("/start") ||
      text.startsWith("/cancel")
    )
      return;

    if (!userSessions.has(chatId)) {
      userSessions.set(chatId, { lastActivity: Date.now() });
    }
    const session = userSessions.get(chatId);
    session.lastActivity = Date.now();

    try {
      // Input sanitization
      const sanitizedText = text.replace(/[<>{}]/g, ""); // Basic sanitization

      if (session.stage === "awaiting_airtime_amount") {
        const amount = parseFloat(sanitizedText);
        if (isNaN(amount) || amount < 50) {
          return bot.sendMessage(chatId, "❌ Enter valid amount (min ₦50).");
        }
        session.airtimeAmount = amount;
        session.stage = "awaiting_airtime_phone";
        return bot.sendMessage(chatId, "📞 Enter phone number:", {
          reply_markup: getCancelKeyboard(),
        });
      }

      if (session.stage === "awaiting_airtime_phone") {
        const phone = sanitizedText.replace(/\D/g, "");
        if (!/^\d{10,14}$/.test(phone)) {
          return bot.sendMessage(chatId, "❌ Invalid phone number. Try again.");
        }
        session.phone = phone;
        session.stage = "confirm_airtime";
        return bot.sendMessage(
          chatId,
          `Confirm Airtime:\nNetwork: *${session.airtimeNetwork.name}*\nAmount: ₦${session.airtimeAmount}\nPhone: ${phone}\n\nSend 'yes' to confirm or click Cancel below`,
          {
            parse_mode: "Markdown",
            reply_markup: getCancelKeyboard(),
          }
        );
      }

      if (session.stage === "confirm_airtime") {
        if (sanitizedText.toLowerCase() === "yes") {
          session.stage = null;
          const user = await db.getUserByTelegramId(userId);
          const wallet = await db.getUserWallet(user.$id);
          if (!wallet || wallet.balance < session.airtimeAmount) {
            userSessions.delete(chatId);
            return bot.sendMessage(
              chatId,
              "❌ Insufficient balance. Please fund your wallet."
            );
          }

          await db.updateWalletBalance(
            user.$id,
            session.airtimeAmount,
            "debit"
          );
          const result = await vtpass.buyAirtime(
            session.airtimeNetwork.airtime_code,
            session.airtimeAmount,
            session.phone
          );
          const transactionStatus =
            result.code === "000" &&
            result.content?.transactions?.status === "delivered"
              ? "success"
              : "failed";
          await db.createTransaction(
            user.$id,
            "airtime",
            session.airtimeAmount,
            {
              reference: `AIRTIME_${user.$id}_${Date.now()}`,
              network: session.airtimeNetwork.name,
              phone: session.phone,
              ...result,
            },
            transactionStatus
          );
          userSessions.delete(chatId);
          return bot.sendMessage(
            chatId,
            transactionStatus === "success"
              ? `✅ Airtime sent to ${session.phone} on ${session.airtimeNetwork.name}!`
              : `❌ Airtime purchase failed: ${
                  result.response_description || "Unknown error"
                }`
          );
        } else if (sanitizedText.toLowerCase() === "cancel") {
          userSessions.delete(chatId);
          return bot.sendMessage(chatId, "❌ Airtime purchase cancelled.");
        }
        return bot.sendMessage(chatId, "Send 'yes' or 'cancel'");
      }

      if (session.stage === "awaiting_data_phone") {
        const phone = sanitizedText.replace(/\D/g, "");
        if (!/^\d{10,14}$/.test(phone)) {
          return bot.sendMessage(chatId, "❌ Invalid phone number. Try again.");
        }
        session.dataPhone = phone;
        session.stage = "awaiting_data_variation";
        const variations = await vtpass.getVariations(
          session.dataNetwork.data_code
        );
        session.variations = variations.content?.varations || [];

        if (!session.variations.length) {
          userSessions.delete(chatId);
          return bot.sendMessage(
            chatId,
            `❌ No data plans found for ${session.dataNetwork.name}. Please try again later or choose another network.`
          );
        }

        const opts = session.variations
          .map(
            (v) =>
              `• ${v.name} (₦${v.variation_amount}) - Code: \`${v.variation_code}\``
          )
          .join("\n");
        return bot.sendMessage(
          chatId,
          `📦 Choose data plan for *${session.dataNetwork.name}*:\n\n${opts}\n\nSend the *variation code* (e.g., \`${session.variations[0].variation_code}\`) to select a plan:`,
          {
            parse_mode: "Markdown",
            reply_markup: getCancelKeyboard(),
          }
        );
      }

      if (session.stage === "awaiting_data_variation") {
        const vcode = sanitizedText.trim();
        const variation = session.variations.find(
          (v) => v.variation_code.toLowerCase() === vcode.toLowerCase()
        );
        if (!variation) {
          return bot.sendMessage(
            chatId,
            "❌ Invalid variation code. Please copy and send the exact code."
          );
        }
        session.variation = variation;
        session.stage = "confirm_data";
        return bot.sendMessage(
          chatId,
          `Confirm Data:\nNetwork: *${session.dataNetwork.name}*\nPlan: ${variation.name}\nAmount: ₦${variation.variation_amount}\nPhone: ${session.dataPhone}\n\nSend 'yes' to confirm or click Cancel below`,
          {
            parse_mode: "Markdown",
            reply_markup: getCancelKeyboard(),
          }
        );
      }

      if (session.stage === "confirm_data") {
        if (sanitizedText.toLowerCase() === "yes") {
          session.stage = null;
          const user = await db.getUserByTelegramId(userId);
          const wallet = await db.getUserWallet(user.$id);
          const cost = parseFloat(session.variation.variation_amount);
          if (!wallet || wallet.balance < cost) {
            userSessions.delete(chatId);
            return bot.sendMessage(
              chatId,
              "❌ Insufficient balance. Please fund your wallet."
            );
          }

          await db.updateWalletBalance(user.$id, cost, "debit");
          const result = await vtpass.buyData(
            session.dataNetwork.data_code,
            session.variation.variation_code,
            session.dataPhone
          );
          const transactionStatus =
            result.code === "000" &&
            result.content?.transactions?.status === "delivered"
              ? "success"
              : "failed";
          await db.createTransaction(
            user.$id,
            "data",
            cost,
            {
              reference: `DATA_${user.$id}_${Date.now()}`,
              network: session.dataNetwork.name,
              plan: session.variation.name,
              phone: session.dataPhone,
              ...result,
            },
            transactionStatus
          );
          userSessions.delete(chatId);
          return bot.sendMessage(
            chatId,
            transactionStatus === "success"
              ? `✅ Data sent to ${session.dataPhone} on ${session.dataNetwork.name} (${session.variation.name})!`
              : `❌ Data purchase failed: ${
                  result.response_description || "Unknown error"
                }`
          );
        } else if (sanitizedText.toLowerCase() === "cancel") {
          userSessions.delete(chatId);
          return bot.sendMessage(chatId, "❌ Data purchase cancelled.");
        }
        return bot.sendMessage(chatId, "Send 'yes' or 'cancel'");
      }

      if (session.stage === "awaiting_meter_number") {
        const meter = sanitizedText.trim();
        if (!/^\d{10,}$/.test(meter)) {
          return bot.sendMessage(chatId, "❌ Invalid meter number. Try again.");
        }
        session.meter = meter;
        const verification = await vtpass.verifyMeterNumber(
          meter,
          session.electricityProvider.code,
          "prepaid"
        );
        if (verification.code !== "000") {
          userSessions.delete(chatId);
          return bot.sendMessage(
            chatId,
            `❌ Meter verification failed: ${
              verification.response_description || "Unknown error"
            }`
          );
        }
        session.stage = "awaiting_meter_amount";
        return bot.sendMessage(
          chatId,
          `✅ Meter verified: ${verification.content.Customer_Name}\n💡 Enter amount to pay:`,
          { reply_markup: getCancelKeyboard() }
        );
      }

      if (session.stage === "awaiting_meter_amount") {
        const amount = parseFloat(sanitizedText);
        if (isNaN(amount) || amount < 100) {
          return bot.sendMessage(chatId, "❌ Enter valid amount (min ₦100).");
        }
        session.amount = amount;
        session.stage = "confirm_electricity";
        return bot.sendMessage(
          chatId,
          `Confirm Payment:\nProvider: ${session.electricityProvider.name}\nMeter: ${session.meter}\nAmount: ₦${amount}\n\nSend 'yes' to confirm or click Cancel below`,
          {
            parse_mode: "Markdown",
            reply_markup: getCancelKeyboard(),
          }
        );
      }

      if (session.stage === "confirm_electricity") {
        if (sanitizedText.toLowerCase() === "yes") {
          session.stage = null;
          const user = await db.getUserByTelegramId(userId);
          const wallet = await db.getUserWallet(user.$id);
          if (!wallet || wallet.balance < session.amount) {
            userSessions.delete(chatId);
            return bot.sendMessage(chatId, "❌ Insufficient balance.");
          }
          await db.updateWalletBalance(user.$id, session.amount, "debit");
          const result = await vtpass.payElectricityBill(
            session.electricityProvider.code,
            session.meter,
            "prepaid",
            session.amount,
            session.phone || "08012345678"
          );
          const transactionStatus =
            result.code === "000" &&
            result.content?.transactions?.status === "delivered"
              ? "success"
              : "failed";
          await db.createTransaction(
            user.$id,
            "electricity",
            session.amount,
            {
              reference: `ELEC_${user.$id}_${Date.now()}`,
              provider: session.electricityProvider.name,
              meter: session.meter,
              ...result,
            },
            transactionStatus
          );
          userSessions.delete(chatId);
          return bot.sendMessage(
            chatId,
            transactionStatus === "success"
              ? `✅ Electricity paid for meter ${session.meter}!`
              : `❌ Electricity payment failed: ${
                  result.response_description || "Unknown error"
                }`
          );
        } else if (sanitizedText.toLowerCase() === "cancel") {
          userSessions.delete(chatId);
          return bot.sendMessage(chatId, "❌ Electricity payment cancelled.");
        }
        return bot.sendMessage(chatId, "Send 'yes' or 'cancel'");
      }

      if (session.stage === "awaiting_card_number") {
        const card = sanitizedText.trim();
        if (!/^\d{10,}$/.test(card)) {
          return bot.sendMessage(
            chatId,
            "❌ Invalid Smart Card Number. Try again."
          );
        }
        session.card = card;
        session.stage = "awaiting_tv_variation";
        const variations = await vtpass.getVariations(session.tvProvider.code);
        session.variations = variations.content?.varations || [];

        if (!session.variations.length) {
          userSessions.delete(chatId);
          return bot.sendMessage(
            chatId,
            `❌ No TV plans found for ${session.tvProvider.name}. Please try again later.`
          );
        }

        const opts = session.variations
          .map(
            (v) =>
              `• ${v.name} (₦${v.variation_amount}) - Code: \`${v.variation_code}\``
          )
          .join("\n");
        return bot.sendMessage(
          chatId,
          `Choose TV plan for *${session.tvProvider.name}*:\n\n${opts}\n\nSend the *variation code*:`,
          {
            parse_mode: "Markdown",
            reply_markup: getCancelKeyboard(),
          }
        );
      }

      if (session.stage === "awaiting_tv_variation") {
        const vcode = sanitizedText.trim();
        const variation = session.variations.find(
          (v) => v.variation_code.toLowerCase() === vcode.toLowerCase()
        );
        if (!variation) {
          return bot.sendMessage(chatId, "❌ Invalid code. Try again.");
        }
        session.variation = variation;
        session.stage = "confirm_tv";
        return bot.sendMessage(
          chatId,
          `Confirm TV:\nProvider: ${session.tvProvider.name}\nCard: ${session.card}\nPlan: ${variation.name}\nAmount: ₦${variation.variation_amount}\n\nSend 'yes' to confirm or click Cancel below`,
          {
            parse_mode: "Markdown",
            reply_markup: getCancelKeyboard(),
          }
        );
      }

      if (session.stage === "confirm_tv") {
        if (sanitizedText.toLowerCase() === "yes") {
          session.stage = null;
          const user = await db.getUserByTelegramId(userId);
          const wallet = await db.getUserWallet(user.$id);
          const cost = parseFloat(session.variation.variation_amount);
          if (!wallet || wallet.balance < cost) {
            userSessions.delete(chatId);
            return bot.sendMessage(chatId, "❌ Insufficient balance.");
          }
          await db.updateWalletBalance(user.$id, cost, "debit");
          const result = await vtpass.payTvSubscription(
            session.tvProvider.code,
            session.card,
            session.variation.variation_code
          );
          const transactionStatus =
            result.code === "000" &&
            result.content?.transactions?.status === "delivered"
              ? "success"
              : "failed";
          await db.createTransaction(
            user.$id,
            "tv",
            cost,
            {
              reference: `TV_${user.$id}_${Date.now()}`,
              provider: session.tvProvider.name,
              card: session.card,
              plan: session.variation.name,
              ...result,
            },
            transactionStatus
          );
          userSessions.delete(chatId);
          return bot.sendMessage(
            chatId,
            transactionStatus === "success"
              ? `✅ TV subscription completed for ${session.card}!`
              : `❌ TV subscription failed: ${
                  result.response_description || "Unknown error"
                }`
          );
        } else if (sanitizedText.toLowerCase() === "cancel") {
          userSessions.delete(chatId);
          return bot.sendMessage(chatId, "❌ TV payment cancelled.");
        }
        return bot.sendMessage(chatId, "Send 'yes' or 'cancel'");
      }

      if (/^\/fund (\d+)/.test(sanitizedText)) {
        const amount = parseFloat(sanitizedText.split(" ")[1]);
        if (isNaN(amount) || amount < 100) {
          return bot.sendMessage(chatId, "❌ Enter a valid amount (min ₦100)");
        }

        try {
          const user = await db.getUserByTelegramId(userId);
          const email = user.email || `${user.telegramId}@example.com`;
          const reference = `FUND_${user.telegramId}_${Date.now()}`;

          const paystackResponse = await paystack.initializePayment(
            email,
            amount,
            reference
          );
          const authUrl = paystackResponse?.data?.authorization_url;

          if (!authUrl) {
            return bot.sendMessage(
              chatId,
              "❌ Failed to create payment link. Try again later."
            );
          }

          await db.createTransaction(
            user.$id,
            "credit",
            amount,
            { reference, method: "paystack" },
            "pending"
          );

          await bot.sendMessage(
            chatId,
            `💰 Click below to fund your wallet with ₦${amount}:\n\n🔗 ${authUrl}\n\n*After successful payment, your wallet will be updated automatically.*`,
            { parse_mode: "Markdown" }
          );

          if (isTestMode) {
            pollPaymentStatus(reference, userId, amount, chatId);
          }
        } catch (err) {
          console.error("/fund error:", err.message);
          return bot.sendMessage(
            chatId,
            "❌ Something went wrong. Try again later."
          );
        }
      }

      if (sanitizedText === "💳 Buy Airtime") {
        session.stage = "awaiting_airtime_network";
        return bot.sendMessage(
          chatId,
          "Please select your network for Airtime:",
          {
            reply_markup: getNetworkKeyboard("airtime"),
          }
        );
      }
      if (sanitizedText === "📱 Buy Data") {
        session.stage = "awaiting_data_network";
        return bot.sendMessage(chatId, "Please select your network for Data:", {
          reply_markup: getNetworkKeyboard("data"),
        });
      }
      if (sanitizedText === "💡 Pay Electricity") {
        session.stage = "awaiting_electricity_provider";
        return bot.sendMessage(
          chatId,
          "Please select your electricity provider:",
          {
            reply_markup: getElectricityProviderKeyboard(),
          }
        );
      }
      if (sanitizedText === "📺 Pay TV") {
        session.stage = "awaiting_tv_provider";
        return bot.sendMessage(chatId, "Please select your TV provider:", {
          reply_markup: getTvProviderKeyboard(),
        });
      }
      if (sanitizedText === "💰 Fund Wallet") {
        return bot.sendMessage(
          chatId,
          "Use command: /fund <amount> (e.g., /fund 500)"
        );
      }
      if (sanitizedText === "📊 Check Balance") {
        const user = await db.getUserByTelegramId(userId);
        const wallet = await db.getUserWallet(user.$id);
        const balance = wallet?.balance ?? 0;
        return bot.sendMessage(chatId, `💼 Balance: ₦${balance.toFixed(2)}`);
      }
      if (sanitizedText === "📜 Transaction History") {
        const user = await db.getUserByTelegramId(userId);
        const txns = await db.getUserTransactions(user.$id);
        if (!txns.length) {
          return bot.sendMessage(chatId, "📭 No transactions found.");
        }
        const lines = txns.map(
          (t) =>
            `• ${t.type.toUpperCase()} ₦${t.amount.toFixed(2)} - ${t.status} (${
              t.createdAt.split("T")[0]
            })`
        );
        return bot.sendMessage(chatId, `📜 Transactions:\n${lines.join("\n")}`);
      }
      if (sanitizedText === "❓ Help") {
        return bot.sendMessage(
          chatId,
          "🆘 Help:\n💳 Buy Airtime\n📱 Buy Data\n💡 Pay Electricity\n📺 Pay TV\n💰 Fund Wallet\n📊 Check Balance\n📜 History"
        );
      }

      if (!session.stage) {
        return bot.sendMessage(
          chatId,
          "❓ Unknown command. Please use the menu buttons or available commands."
        );
      }
    } catch (err) {
      console.error("Handler Error:", err);
      userSessions.delete(chatId);
      return bot.sendMessage(
        chatId,
        "❌ Something went wrong. The process has been reset. Please try again from the menu."
      );
    }
  })
);

// Start the webhook server
app.listen(WEBHOOK_PORT, () => {
  console.log(`Webhook server running on port ${WEBHOOK_PORT}`);
});

console.log("🤖 VTU Bot started successfully!");
console.log(`🧪 Running in ${isTestMode ? "TEST" : "LIVE"} mode`);
if (isTestMode) {
  console.log("⚠️ TEST MODE ACTIVE - No real transactions will be processed");
  console.log("💡 Use test credentials and expect simulated responses");
}

process.on("SIGINT", () => {
  console.log("\n👋 Bot shutting down...");
  bot.stopPolling();
  process.exit(0);
});
// Telegram Webhook Setup
const TELEGRAM_WEBHOOK_PATH = `/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const WEBHOOK_URL = `${process.env.RENDER_EXTERNAL_URL}${TELEGRAM_WEBHOOK_PATH}`;

// Tell Telegram to send updates to our webhook
await bot.setWebHook(WEBHOOK_URL);

// Handle incoming updates
app.post(TELEGRAM_WEBHOOK_PATH, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});


export { bot, vtpass, paystack, db };