// services/paystack.js
import axios from "axios";
import { setTimeout } from "timers/promises";

class PaystackService {
  constructor() {
    this.baseURL = "https://api.paystack.co";
    this.secretKey = process.env.PAYSTACK_SECRET_KEY;
    this.isTestMode = process.env.PAYSTACK_TEST_MODE === "true";
    this.callbackUrl =
      process.env.PAYSTACK_CALLBACK_URL || "https://t.me/muhdata_bot";

    if (!this.secretKey) {
      throw new Error("PAYSTACK_SECRET_KEY is not defined");
    }

    console.log(
      `🧪 Paystack Service initialized in ${
        this.isTestMode ? "TEST" : "LIVE"
      } mode`
    );

    if (this.isTestMode && !this.secretKey.startsWith("sk_test_")) {
      console.warn(
        "⚠️ Warning: Test mode enabled but secret key doesn't appear to be a test key"
      );
    }
  }

  async initializePayment(email, amount, reference) {
    try {
      if (!email || !amount || !reference) {
        throw new Error("email, amount, and reference are required");
      }

      if (this.isTestMode) {
        console.log("🧪 Test Payment Initialization:", {
          email,
          amount,
          reference,
        });
      }

      const response = await this.makeRequest(
        `${this.baseURL}/transaction/initialize`,
        {
          email,
          amount: amount * 100, // Convert to kobo
          reference,
          callback_url: this.callbackUrl,
          channels: this.isTestMode
            ? ["card"]
            : ["card", "bank", "ussd", "mobile_money"],
        }
      );

      if (this.isTestMode) {
        console.log("🧪 Test Payment Response:", response.data);
      }

      return response.data;
    } catch (error) {
      console.error("Paystack Error:", error.response?.data || error.message);
      throw new Error("Payment initialization failed");
    }
  }

  async verifyPayment(reference) {
    try {
      if (!reference) throw new Error("reference is required");

      if (this.isTestMode) {
        console.log("🧪 Test Payment Verification:", reference);
      }

      const response = await axios.get(
        `${this.baseURL}/transaction/verify/${reference}`,
        {
          headers: {
            Authorization: `Bearer ${this.secretKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (this.isTestMode) {
        console.log("🧪 Test Verification Response:", response.data);
      }

      return response.data;
    } catch (error) {
      console.error("Paystack Verification Error:", {
        message: error.message,
        url: `${this.baseURL}/transaction/verify/${reference}`,
        response: error.response?.data,
      });
      throw new Error("Payment verification failed");
    }
  }

  // Used for transaction initialization only (POST requests)
  async makeRequest(url, data) {
    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        return await axios.post(url, data, {
          headers: {
            Authorization: `Bearer ${this.secretKey}`,
            "Content-Type": "application/json",
          },
        });
      } catch (error) {
        if (error.response?.status === 429 && attempt < maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
          console.warn(`Rate limit hit, retrying after ${delay}ms...`);
          await setTimeout(delay);
          attempt++;
          continue;
        }
        throw error;
      }
    }
  }

  generateTestPaymentResponse(reference, amount, email) {
    return {
      status: true,
      message: "Verification successful",
      data: {
        id: Math.floor(Math.random() * 1000000),
        domain: "test",
        status: "success",
        reference,
        amount: amount * 100,
        message: null,
        gateway_response: "Successful",
        paid_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        channel: "card",
        currency: "NGN",
        ip_address: "127.0.0.1",
        metadata: "",
        log: null,
        fees: amount * 0.015 * 100,
        fees_split: null,
        authorization: {
          authorization_code: "AUTH_test123",
          bin: "408408",
          last4: "4081",
          exp_month: "12",
          exp_year: "2030",
          channel: "card",
          card_type: "visa DEBIT",
          bank: "Test Bank",
          country_code: "NG",
          brand: "visa",
          reusable: true,
          signature: "SIG_test123",
        },
        customer: {
          id: Math.floor(Math.random() * 100000),
          first_name: "",
          last_name: "",
          email,
          customer_code: "CUS_test123",
          phone: "",
          metadata: {},
          risk_action: "default",
        },
        plan: null,
        order_id: null,
        paidAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        requested_amount: amount * 100,
        pos_transaction_data: null,
        source: null,
        fees_breakdown: null,
      },
    };
  }
}

export default PaystackService;