/**
 * Google Apps Script for Shiv Juice Center
 * Associated Gmail: kanhaiyapandat4@gmail.com
 *
 * HOW TO ACTIVATE IN GOOGLE DRIVE:
 * 1. Go to https://sheets.google.com and create a new Google Sheet named "Shiv Juice Center Orders".
 * 2. In the top menu, click Extensions > Apps Script.
 * 3. Delete any default code, paste this entire file, and click Save (disk icon).
 * 4. Click Deploy > New deployment.
 * 5. Under "Select type", choose "Web app".
 * 6. Set "Execute as": "Me (kanhaiyapandat4@gmail.com)".
 * 7. Set "Who has access": "Anyone" (so the website server can submit orders).
 * 8. Click Deploy and copy the Web App URL.
 * 9. Paste that Web App URL in server.js (GOOGLE_SHEET_WEBHOOK_URL).
 */

function doPost(e) {
  try {
    var rawData = e.postData.contents;
    var data = JSON.parse(rawData);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

    // Initialize Header Row if empty
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        "OrderID",
        "Timestamp",
        "Customer Name",
        "Customer Email",
        "Mobile Number",
        "Delhi Locality",
        "Flat / House",
        "Street / Area",
        "Landmark",
        "PIN Code",
        "Full Address",
        "Product Name",
        "Quantity",
        "Total (₹)",
        "Payment Method",
        "Address Type",
        "Shop Origin Hub"
      ]);
      // Style header
      var headerRange = sheet.getRange(1, 1, 1, 17);
      headerRange.setBackground("#780026");
      headerRange.setFontColor("#ffffff");
      headerRange.setFontWeight("bold");
    }

    var productName = data.productName || data.juiceItem || "Classic Damascus Rose Milk";

    // Append new order row with exact clicked product name
    sheet.appendRow([
      data.orderId || "SJC-" + new Date().getTime(),
      data.timestamp || new Date().toISOString(),
      data.name || "Customer",
      data.customerEmail || "kanhaiyapandat4@gmail.com",
      data.mobile || "",
      data.delhiLocality || "Sonia Vihar 3rd Pusta",
      data.flatHouse || "",
      data.areaStreet || "",
      data.landmark || "",
      data.pincode || "110094",
      data.address || "",
      productName,
      data.quantity || 1,
      data.total || data.finalAmount || 0,
      data.paymentMethod || "Cash on Delivery",
      data.addressType || "Home",
      data.shopOrigin || "Shiv Juice Center, Sonia Vihar 3rd Pusta, Delhi - 110094"
    ]);

    // Send notification email to kanhaiyapandat4@gmail.com
    var adminEmail = "kanhaiyapandat4@gmail.com";
    var adminSubject = "Order are placed - #" + (data.orderId || "SJC") + " (" + productName + ")";
    var adminMessage = "order are placed\n\n" +
      "Order ID: #" + (data.orderId || "") + "\n" +
      "Product Name: " + productName + "\n" +
      "Customer Name: " + (data.name || "") + "\n" +
      "Customer Email: " + (data.customerEmail || "Not specified") + "\n" +
      "Mobile: +91 " + (data.mobile || "") + "\n" +
      "Locality: " + (data.delhiLocality || "") + ", Delhi\n" +
      "Address: " + (data.address || "") + "\n" +
      "Quantity: " + (data.quantity || 1) + "\n" +
      "Total: ₹" + (data.total || data.finalAmount || 0) + "\n" +
      "Payment: " + (data.paymentMethod || "Cash on Delivery") + "\n\n" +
      "Dispatched from: Shiv Juice Center, Sonia Vihar 3rd Pusta Hub";
      "Full Address: " + (data.address || "") + "\n" +
      "Item: " + (data.juiceItem || "") + " (Qty: " + (data.quantity || 1) + ")\n" +
      "Total Amount: ₹" + (data.total || 0) + "\n" +
      "Payment: " + (data.paymentMethod || "Cash on Delivery") + "\n\n" +
      "Shop Hub: Shiv Juice Center, Sonia Vihar 3rd Pusta, Delhi - 110094";

    MailApp.sendEmail({
      to: adminEmail,
      subject: adminSubject,
      body: adminMessage
    });

    // Send confirmation email to Customer (the email they logged in with)
    if (data.customerEmail && data.customerEmail.includes("@") && data.customerEmail !== adminEmail) {
      var customerSubject = "Order are placed - Shiv Juice Center #" + (data.orderId || "SJC");
      var customerMessage = "order are placed\n\n" +
        "Dear " + (data.name || "Customer") + ",\n\n" +
        "Your order #" + (data.orderId || "") + " has been placed successfully!\n\n" +
        "Item: " + (data.juiceItem || "") + " (Quantity: " + (data.quantity || 1) + ")\n" +
        "Total Amount: ₹" + (data.total || 0) + "\n" +
        "Delivery Address: " + (data.address || "") + "\n" +
        "Payment Mode: " + (data.paymentMethod || "Cash on Delivery") + "\n\n" +
        "Your chilled fresh juice is being prepared and will be dispatched from our hub at:\n" +
        "Shiv Juice Center, Sonia Vihar 3rd Pusta, Delhi - 110094\n\n" +
        "Thank you for choosing Shiv Juice Center!";

      try {
        MailApp.sendEmail({
          to: data.customerEmail,
          subject: customerSubject,
          body: customerMessage
        });
      } catch (errCust) {
        Logger.log("Customer email notice skipped: " + errCust.message);
      }
    }

    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      message: "Order recorded in Google Sheet and emails sent successfully",
      orderId: data.orderId
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
