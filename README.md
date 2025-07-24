# Snipe-IT to Jamf Pro & Google Sheets Webhook Integration (Jamf Pro API)

This Google Apps Script acts as a webhook receiver for Snipe-IT, automating the update of computer `User and Location` information in Jamf Pro and logging all relevant events to a Google Sheet whenever an asset is checked in or checked out in Snipe-IT.

**This version of the script uses the newer Jamf Pro API for all Jamf interactions.**

**Features:**
* Receives `asset.checkedin` and `asset.checkedout` webhooks from Snipe-IT.
* Authenticates incoming webhooks using a shared secret provided as a **URL query parameter (`?secret=YOUR_SECRET_HERE`)**. It can also still accept `X-Webhook-Secret` header if your Snipe-IT instance (or an intermediary proxy) could add it.
* Validates the source host (`Referer` or `Origin` header) to ensure it comes from your Snipe-IT instance.
* Authenticates with Jamf Pro using API Client credentials (OAuth token flow for the `/api/v1/auth/token` endpoint).
* Finds the computer in Jamf Pro by its serial number using the `/api/v1/computers-inventory` endpoint with a `filter`.
* Updates the Jamf Pro computer's "User and Location" fields (`username`, `realName`, `building`, and `department`) using a `PATCH` request to the `/api/v1/computers-inventory/{id}` endpoint.
    * On **check-out**: Updates with Snipe-IT's assigned user and location.
    * On **check-in**: Clears the Jamf `username` and `realName` fields, and sets `building` and `department` to the Snipe-IT location (representing its return to that location in inventory).
* Logs all webhook events, Jamf API interactions, and any errors to a **specified Google Sheet tab/name**.

## Table of Contents

* [Prerequisites](#prerequisites)
* [Setup Instructions](#setup-instructions)
    * [1. Google Sheets Setup](#1-google-sheets-setup)
    * [2. Google Apps Script Setup](#2-google-apps-script-setup)
    * [3. Jamf Pro Setup](#3-jamf-pro-setup)
    * [4. Snipe-IT Setup](#4-snipe-it-setup)
* [Usage](#usage)
* [Logging](#logging)
* [Troubleshooting](#troubleshooting)
* [Security Considerations](#security-considerations)
* [License](#license)

## Prerequisites

Before you begin, ensure you have:

* **Google Account:** To host the Google Sheet and Google Apps Script.
* **Snipe-IT Instance:** Running version 8 or later.
* **Jamf Pro Instance:** Access to API roles and clients.
* **Understanding of APIs:** Basic familiarity with REST APIs and JSON.

## Setup Instructions

Follow these steps carefully to set up the entire integration.

### 1. Google Sheets Setup

This will be your logging sheet and host for the Apps Script.

1.  **Create a New Google Sheet:**
    * Go to [Google Sheets](https://docs.google.com/spreadsheets/u/0/) and create a new blank spreadsheet.
    * Name it something descriptive, e.g., "Snipe-IT Jamf Integration Log".
2.  **Rename Log Sheet Tab:**
    * By default, a new sheet is named `Sheet1`. **Rename this tab** to your desired log sheet name (e.g., "Webhook Log"). You'll use this name in your Apps Script properties.
3.  **Add Header Row (Optional but Recommended):**
    * In the first row of your renamed log sheet, add the following headers (or similar, matching the log entries in `appendLog` function):
        * `Timestamp`
        * `Status` (e.g., 'Success', 'Failed', 'Unauthorized', 'Ignored')
        * `Event Type` (e.g., 'asset.checkedin', 'asset.checkedout')
        * `Serial Number`
        * `Assigned Username`
        * `Assigned Real Name`
        * `Snipe-IT Location Name`
        * `Details/Error Message`

### 2. Google Apps Script Setup

This is where the webhook receiver logic resides.

1.  **Open Script Editor:**
    * From your newly created Google Sheet, go to `Extensions > Apps Script`. This will open a new browser tab with the Apps Script editor.
2.  **Paste the Code:**
    * Delete any existing code in `Code.gs`.
    * Copy the entire content from the `Code.gs` section provided in this solution and paste it into your `Code.gs` file in the Apps Script editor.
3.  **Set Script Properties:**
    * In the Apps Script editor, go to `Project settings` (gear icon on the left sidebar).
    * Scroll down to "Script properties" and click `Add script property`.
    * Add the following properties with their corresponding values (you'll get `JAMF_CLIENT_ID` and `JAMF_CLIENT_SECRET` from Jamf Pro setup):
        * `JAMF_URL`: Your Jamf Pro URL (e.g., `https://yourinstance.jamfcloud.com`)
        * `JAMF_CLIENT_ID`: The Client ID for your Jamf API Client (from Jamf setup)
        * `JAMF_CLIENT_SECRET`: The Client Secret for your Jamf API Client (from Jamf setup)
        * `WEBHOOK_SECRET`: A strong, random secret string (e.g., `aR4nD0mS3cr3tStr1nG!@#`). This will be used to authenticate the webhook.
        * `SNIPEIT_HOST`: The full URL of your Snipe-IT instance (e.g., `https://your.snipeit.url`). **Crucial for host validation.**
        * `LOG_SHEET_NAME`: The exact name of the sheet tab you want to use for logging (e.g., `Webhook Log`).
    * Click `Save script properties`.
4.  **Deploy as Web App:**
    * In the Apps Script editor, click on `Deploy > New deployment`.
    * Click the "Select type" cog icon and choose `Web app`.
    * **Deployment configuration:**
        * **Description:** "Snipe-IT Webhook Receiver for Jamf and Google Sheets" (or similar).
        * **Execute as:** `Me` (your Google Account email).
        * **Who has access:** `Anyone` (this allows Snipe-IT to send webhooks without specific Google authentication).
    * Click `Deploy`.
    * **Authorization:** The first time you deploy, you'll be prompted to authorize the script.
        * Click `Authorize access`.
        * Select your Google Account.
        * You'll see a warning "Google hasn't verified this app." This is normal for your own script. Click `Advanced` and then `Go to <Project Name> (unsafe)`.
        * Click `Allow` to grant the script permissions (e.g., to connect to external services and manage your spreadsheets).
    * After authorization, the deployment dialog will reappear. Click `Deploy` again if necessary.
    * **Copy Web App URL:** Once deployed, you will see a "Web app URL". **Copy this URL** as you will need it for Snipe-IT setup. It will look something like `https://script.google.com/macros/s/AKfycb.../exec`. Keep this URL secure.
    * Click `Done`.

### 3. Jamf Pro Setup

You need an API Client with appropriate permissions in Jamf Pro.

1.  **Create an API Role:**
    * Log in to Jamf Pro as an administrator.
    * Navigate to `Settings` (gear icon) > `System` > `API Roles and Clients`.
    * Go to the `API Roles` tab and click `+ New`.
    * **Name:** `Snipe-IT Integration` (or similar).
    * **Privileges:** Assign the minimum necessary privileges for this integration. For `computers-inventory` endpoints, you'll typically need:
        * `Computers` (under `Jamf Pro API`):
            * `Read Computer Inventory`
            * `Update Computer Inventory`
        * `API Integrations` (under `Jamf Pro API`):
            * `Create API Integrations` (for token generation)
            * `Read API Integrations` (for token generation)
    * Click `Save`.
2.  **Create an API Client:**
    * While still in `Settings > System > API Roles and Clients`, go to the `API Clients` tab and click `+ New`.
    * **Client Name:** `Snipe-IT Integration Client` (or similar).
    * **API Role:** Select the API Role you just created (e.g., `Snipe-IT Integration`).
    * Ensure `Enabled` is checked.
    * Click `Save`.
    * **Generate Client Secret:** Jamf will prompt you to generate a client secret. Click `Generate client secret`.
    * **Copy Client ID and Client Secret:** **Immediately copy the `Client ID` and `Client Secret`**. These are shown only once. Paste them into the `JAMF_CLIENT_ID` and `JAMF_CLIENT_SECRET` script properties in your Google Apps Script editor (from Step 2.3).
    * Click `Close`.

### 4. Snipe-IT Setup

Configure Snipe-IT to send webhooks to your Google Apps Script.

1.  **Log in to Snipe-IT as an Administrator.**
2.  **Navigate to Integrations Settings:**
    * Go to `Admin` (gear icon) > `Settings`.
    * Click on the `Integrations` tab.
3.  **Configure General Webhook:**
    * Ensure `Webhooks Enabled` is checked.
    * **General Webhook Endpoint:** This is where you'll combine your Web App URL and the secret.
        * **Take the "Web app URL" you copied from Google Apps Script deployment (Step 2.4).**
        * **Append `?secret=YOUR_WEBHOOK_SECRET` to the end of that URL.**
        * **Example:** If your Web App URL is `https://script.google.com/macros/s/AKfycb.../exec` and your `WEBHOOK_SECRET` is `mySuperSecret`, then the URL you enter here will be:
            ```
            [https://script.google.com/macros/s/AKfycb.../exec?secret=mySuperSecret](https://script.google.com/macros/s/AKfycb.../exec?secret=mySuperSecret)
            ```
        * **Paste this combined URL into the "General Webhook Endpoint" field.**
    * **General Webhook Channel (Optional):** Leave this blank or set as desired; it's generally not used for custom HTTP endpoints unless your receiving system has a specific requirement.
    * **General Webhook Botname (Optional):** You can set this to `Snipe-Bot` or any other name you prefer. This field is for display purposes, typically for chat integrations, and doesn't affect functionality here.
    * **Test Integration:** Click the `Test Integration` button.
        * Check your Google Sheet (specifically the named log sheet tab); you should see a new row logged indicating a "Test Webhook" event and success/failure.
        * If it fails, review your URLs, secrets, and script properties.
    * Scroll to the bottom of the page and click `Save`.

## Usage

Once configured, the integration will work automatically:

* Whenever an **Asset is Checked Out** in Snipe-IT:
    * A webhook is sent to your Google Apps Script.
    * The script processes the payload.
    * It attempts to update the corresponding computer in Jamf Pro with the assigned user's username, real name, and the asset's Snipe-IT location in the `User and Location` section.
    * A log entry is added to your Google Sheet.
* Whenever an **Asset is Checked In** in Snipe-IT:
    * A webhook is sent to your Google Apps Script.
    * The script processes the payload.
    * It attempts to update the corresponding computer in Jamf Pro, clearing the `username` and `realName` fields, and setting `building` and `department` fields to the asset's Snipe-IT location (representing its return to that location in inventory).
    * A log entry is added to your Google Sheet.

## Logging

All webhook events and the results of the Jamf Pro update will be logged to the **specified Google Sheet tab** you created. This is invaluable for monitoring and troubleshooting.

The log entries will include:
* Timestamp
* Status (Success, Failed, Unauthorized, Ignored)
* Event Type (asset.checkedout, asset.checkedin, test_webhook, etc.)
* Serial Number
* Assigned Username
* Assigned Real Name
* Snipe-IT Location Name
* Details/Error Message

## Troubleshooting

* **Check Apps Script Executions:** In the Apps Script editor, go to `Executions` (the clock icon on the left sidebar). This log will show every time your script runs and any `console.log` messages or errors. This is your primary debugging tool.
* **Verify Script Properties:** Double-check that all `JAMF_URL`, `JAMF_CLIENT_ID`, `JAMF_CLIENT_SECRET`, `WEBHOOK_SECRET`, `SNIPEIT_HOST`, and **`LOG_SHEET_NAME`** properties are correct in `Project settings > Script properties`.
* **Jamf Pro API Client Permissions:** Ensure the API Role assigned to your Jamf API Client has `Read` and `Update` privileges for `Computer Inventory`.
* **Webhook Secret Mismatch:** The `WEBHOOK_SECRET` in Apps Script properties **must** exactly match the secret you appended to the URL in Snipe-IT. It's case-sensitive.
* **Host Mismatch:** Ensure `SNIPEIT_HOST` in Apps Script exactly matches the base URL of your Snipe-IT instance (e.g., `https://your.snipeit.url`). This check is case-sensitive and verifies the `Referer` or `Origin` header.
* **Google Sheet Permissions & Named Sheet:** Ensure the Google Sheet is accessible to the Apps Script (it should be by default if created together) and that the `LOG_SHEET_NAME` property **exactly matches** the name of your log sheet tab in Google Sheets (case-sensitive). If the named sheet isn't found, the script will attempt to log to the first available sheet and log an error.

## Security Considerations

* **Webhook Secret in URL:** While convenient, placing the secret in the URL means it might appear in server logs, proxy logs, or browser histories (if manually tested). Use a strong, random, and unique `WEBHOOK_SECRET`. Do not reuse passwords.
* **IP Whitelisting (Advanced):** For enhanced security, if your Snipe-IT instance has a static outbound IP address, you could restrict incoming connections to your Google Apps Script Web App (if hosted on a server that allows this, which is typically not the case for standard Apps Script deployments) or implement IP checks within the `doPost` function (more complex).
* **Jamf API Client Scopes:** Grant only the minimum necessary privileges to your Jamf API Client.
* **Data Exposure:** The script logs data to a Google Sheet. Ensure this sheet's sharing settings are appropriate for your organization's data sensitivity.

## License

This script is provided as-is for educational and functional purposes. You are free to use, modify, and distribute it according to your needs. No warranty is implied.