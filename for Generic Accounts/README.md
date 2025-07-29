# Snipe-IT to Jamf Pro & Google Sheets Webhook Integration (Jamf Pro API)
## Generated with Gemini

This Google Apps Script acts as a webhook listener for Snipe-IT, automatically updating Jamf Pro computer records when assets are checked out or checked in. It's designed to ensure a consistent 200 OK response to Snipe-IT, even if internal processing encounters issues, to prevent redirect errors.

## Features

* **Automated Jamf Updates:** Syncs user and location information in Jamf Pro based on Snipe-IT asset check-out and check-in events.

* **Robust Payload Parsing:** Handles the specific `text` and `attachments` payload structure sent by Snipe-IT webhooks for asset events.

* **Serial Number Lookup:** Queries Snipe-IT's API using the asset tag to retrieve the device's serial number, ensuring accurate updates in Jamf Pro.

* **Consistent 200 OK Response:** Always returns an HTTP 200 success code to the calling Snipe-IT webhook, preventing redirect errors.

* **Security Validation:** Includes secret and referrer/origin host validation for incoming webhooks.

* **Comprehensive Logging:** Logs all webhook activity and processing outcomes to a Google Sheet for easy monitoring and debugging.

* **Jamf Pro API Token Management:** Automatically obtains and caches Jamf Pro API bearer tokens.

* **Snipe-IT Test Webhook Support:** Gracefully handles Snipe-IT's default test webhook payload.

## How it Works

1.  **Snipe-IT Webhook Trigger:** When an asset is checked out or checked in in Snipe-IT, it sends a webhook POST request to your deployed Google Apps Script URL.

2.  **Request Validation:** The script validates the incoming request using a shared secret and, optionally, the originating host.

3.  **Payload Parsing:** It parses the complex JSON payload from Snipe-IT, extracting the asset tag, assigned user's name, and location from the `text` and `attachments` fields.

4.  **Snipe-IT API Lookup:** Using the extracted asset tag, the script makes an API call back to your Snipe-IT instance to retrieve the asset's actual serial number. This is crucial as the initial webhook payload doesn't contain the serial directly.

5.  **Jamf Pro Update:** With the serial number, the script then authenticates with your Jamf Pro instance and updates the computer record's user and location fields.

6.  **Logging:** All steps, including successes and failures, are logged to a Google Sheet.

7.  **200 OK Response:** Regardless of the outcome of the Jamf update or any internal errors, the script always responds with an HTTP 200 OK status to Snipe-IT to ensure the webhook is considered successful on Snipe-IT's side.

## Setup

### Google Apps Script Setup

1.  **Create a New Google Apps Script Project:**

    * Go to [script.google.com](https://script.google.com/).

    * Click `New project`.

2.  **Paste the Code:**

    * Copy the entire code from the `google-apps-script-webhook` immersive artifact (from our previous conversation).

    * Paste it into the `Code.gs` file in your new Apps Script project, replacing any existing content.

3.  **Configure Script Properties:**

    * In the Apps Script editor, click on **Project settings** (the gear icon on the left sidebar).

    * Scroll down to **Script properties**.

    * Click **Add script property** and add the following properties, replacing the placeholder values with your actual information:

        * `JAMF_URL`: Your Jamf Pro URL (e.g., `https://yourjamf.jamfcloud.com`)

        * `JAMF_USERNAME`: A Jamf Pro API-enabled username (for token generation).

        * `JAMF_PASSWORD`: The password for the Jamf Pro API username.

        * `WEBHOOK_SECRET`: A secret string of your choice (e.g., a long random string). This will be used to secure your webhook.

        * `SNIPEIT_HOST`: Your Snipe-IT instance URL (e.g., `https://your.snipeit.url`).

        * `SNIPEIT_API_KEY`: The Personal Access Token generated from Snipe-IT (see **Snipe-IT Setup** below).

        * `LOG_SHEET_NAME` (Optional): The name of the Google Sheet tab where logs will