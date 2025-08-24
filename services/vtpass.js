import axios from "axios";

class VTPassService {
  constructor() {
    this.baseURL =
      process.env.VTPASS_BASE_URL || "https://sandbox.vtpass.com/api";
    this.apiKey = process.env.VTPASS_API_KEY;
    this.secretKey = process.env.VTPASS_SECRET_KEY;
    this.isTestMode = process.env.VTPASS_TEST_MODE === "true";

    if (!this.apiKey || !this.secretKey) {
      throw new Error("VTPASS_API_KEY and VTPASS_SECRET_KEY are required");
    }

    console.log(
      `🧪 VTPass Service initialized in ${
        this.isTestMode ? "TEST" : "LIVE"
      } mode`
    );
  }

  generateRequestId() {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async makeRequest(endpoint, data = {}) {
    try {
      if (this.isTestMode && endpoint === "pay") {
        return await this.simulateTestResponse(data);
      }

      const response = await axios.post(`${this.baseURL}/${endpoint}`, data, {
        headers: {
          "api-key": this.apiKey,
          "secret-key": this.secretKey,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      });

      return response.data;
    } catch (error) {
      console.error("VTPass API Error:", error.response?.data || error.message);
      if (this.isTestMode) {
        return this.simulateTestError();
      }
      throw new Error("Service temporarily unavailable");
    }
  }

  simulateTestResponse(data) {
    console.log("🧪 Simulating VTPass test response for:", data);
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          code: "000",
          response_description: "SUCCESS",
          content: {
            transactions: {
              status: "delivered",
              product_name: this.getProductName(data.serviceID),
              unique_element: data.phone || data.billersCode,
              unit_price: data.amount || data.variation_amount || 0,
              quantity: 1,
              service_verification: null,
              channel: "api",
              commission: 0,
              total_amount: data.amount || data.variation_amount || 0,
              discount: 0,
              type: "VTU",
              email: "test@example.com",
              phone: data.phone || "08012345678",
              name: null,
              convenience_fee: 0,
              amount: data.amount || data.variation_amount || 0,
              platform: "api",
              method: "api",
              transactionId: `TEST_${this.generateRequestId()}`,
            },
          },
          transaction_id: {
            transactionId: `TEST_${this.generateRequestId()}`,
            date: new Date().toISOString(),
          },
          amount: data.amount || data.variation_amount || 0,
          phone: data.phone,
          date: new Date().toISOString(),
        });
      }, 2000);
    });
  }

  simulateTestError() {
    const errors = [
      {
        code: "016",
        response_description: "TRANSACTION FAILED",
        content: { error: "Insufficient balance on merchant account" },
      },
      {
        code: "015",
        response_description: "INVALID PHONE NUMBER",
        content: { error: "Phone number is invalid" },
      },
      {
        code: "014",
        response_description: "NETWORK ERROR",
        content: { error: "Network temporarily unavailable" },
      },
    ];
    return errors[Math.floor(Math.random() * errors.length)];
  }

  getProductName(serviceID) {
    const products = {
      mtn: "MTN Airtime",
      airtel: "Airtel Airtime",
      glo: "Glo Airtime",
      "9mobile": "9mobile Airtime",
      "mtn-data": "MTN Data",
      "airtel-data": "Airtel Data",
      "glo-data": "Glo Data",
      "9mobile-data": "9mobile Data",
      "ikeja-electric": "Ikeja Electric",
      "eko-electric": "Eko Electric",
      dstv: "DStv Subscription",
      gotv: "GOtv Subscription",
    };
    return products[serviceID] || "VTU Service";
  }

  async buyAirtime(serviceID, amount, phone) {
    if (!serviceID || !amount || !phone) {
      throw new Error("serviceID, amount, and phone are required");
    }
    const requestId = this.generateRequestId();
    console.log(`🧪 Test Airtime Purchase:`, {
      service: serviceID,
      amount,
      phone,
      requestId,
      testMode: this.isTestMode,
    });

    return await this.makeRequest("pay", {
      request_id: requestId,
      serviceID,
      amount,
      phone,
    });
  }

  async buyData(serviceID, variation_code, phone) {
    if (!serviceID || !variation_code || !phone) {
      throw new Error("serviceID, variation_code, and phone are required");
    }
    const requestId = this.generateRequestId();
    console.log(`🧪 Test Data Purchase:`, {
      service: serviceID,
      variation: variation_code,
      phone,
      requestId,
      testMode: this.isTestMode,
    });

    return await this.makeRequest("pay", {
      request_id: requestId,
      serviceID,
      billersCode: phone,
      variation_code,
    });
  }

  async payElectricityBill(
    serviceID,
    billersCode,
    variation_code,
    amount,
    phone
  ) {
    if (!serviceID || !billersCode || !variation_code || !amount || !phone) {
      throw new Error("All parameters are required");
    }
    const requestId = this.generateRequestId();
    console.log(`🧪 Test Electricity Payment:`, {
      service: serviceID,
      meter: billersCode,
      variation: variation_code,
      amount,
      phone,
      requestId,
      testMode: this.isTestMode,
    });

    return await this.makeRequest("pay", {
      request_id: requestId,
      serviceID,
      billersCode,
      variation_code,
      amount,
      phone,
    });
  }

  async payTvSubscription(serviceID, billersCode, variation_code) {
    if (!serviceID || !billersCode || !variation_code) {
      throw new Error(
        "serviceID, billersCode, and variation_code are required"
      );
    }
    const requestId = this.generateRequestId();
    console.log(`🧪 Test TV Subscription:`, {
      service: serviceID,
      card: billersCode,
      variation: variation_code,
      requestId,
      testMode: this.isTestMode,
    });

    return await this.makeRequest("pay", {
      request_id: requestId,
      serviceID,
      billersCode,
      variation_code,
    });
  }

  async getVariations(serviceID) {
    if (!serviceID) throw new Error("serviceID is required");
    if (this.isTestMode) {
      return this.getMockVariations(serviceID);
    }
    return await this.makeRequest("service-variations", { serviceID });
  }

  getMockVariations(serviceID) {
    const mockVariations = {
      "mtn-data": {
        code: "000",
        response_description: "SUCCESS",
        content: {
          ServiceName: "MTN Data",
          serviceID: "mtn-data",
          variations: [
            {
              variation_code: "M1024",
              name: "MTN Data 1GB",
              variation_amount: "500",
              fixedPrice: "Yes",
            },
            {
              variation_code: "M2024",
              name: "MTN Data 2GB",
              variation_amount: "1000",
              fixedPrice: "Yes",
            },
            {
              variation_code: "M3024",
              name: "MTN Data 3GB",
              variation_amount: "1500",
              fixedPrice: "Yes",
            },
            {
              variation_code: "M5024",
              name: "MTN Data 5GB",
              variation_amount: "2500",
              fixedPrice: "Yes",
            },
          ],
        },
      },
      dstv: {
        code: "000",
        response_description: "SUCCESS",
        content: {
          ServiceName: "DStv",
          serviceID: "dstv",
          variations: [
            {
              variation_code: "dstv-padi",
              name: "DStv Padi",
              variation_amount: "2500",
              fixedPrice: "Yes",
            },
            {
              variation_code: "dstv-confam",
              name: "DStv Confam",
              variation_amount: "5500",
              fixedPrice: "Yes",
            },
            {
              variation_code: "dstv-compact",
              name: "DStv Compact",
              variation_amount: "12000",
              fixedPrice: "Yes",
            },
          ],
        },
      },
    };
    return (
      mockVariations[serviceID] || {
        code: "001",
        response_description: "Service not found",
      }
    );
  }

  async verifyMeterNumber(billersCode, serviceID, type = "prepaid") {
    if (!billersCode || !serviceID) {
      throw new Error("billersCode and serviceID are required");
    }
    if (this.isTestMode) {
      return {
        code: "000",
        response_description: "SUCCESS",
        content: {
          Customer_Name: "Test Customer",
          Status: "Active",
          Due_Date: "2024-12-31",
          Customer_Number: billersCode,
          Customer_Type: type,
          Current_Bouquet: "Test Package",
          Current_Bouquet_Code: "test-001",
        },
      };
    }
    return await this.makeRequest("merchant-verify", {
      billersCode,
      serviceID,
      type,
    });
  }
}

export default VTPassService;