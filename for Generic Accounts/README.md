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

        * `LOG_SHEET_NAME` (Optional): The name of the Google Sheet tab where logs will be written (e.g., `Webhook Log`). If not set, it defaults to 'Webhook Log'.

4.  **Deploy as Web App:**

    * Click **Deploy** > **New deployment**.

    * Click the gear icon next to "Select type" and choose **Web app**.

    * Configure the deployment:

        * **Description:** (Optional) e.g., "Snipe-IT to Jamf Webhook"

        * **Execute as:** `Me` (your Google account)

        * **Who has access:** `Anyone` (This is crucial for the webhook to be publicly accessible. Security is handled by `WEBHOOK_SECRET` and `SNIPEIT_HOST` validation within the script.)

    * Click **Deploy**.

    * **Authorize** the script if prompted.

    * **Copy the "Web app URL"**. This is the URL you will use in Snipe-IT. It will end with `/exec`.

### Snipe-IT Setup

1.  **Generate a Personal Access Token (API Key):**

    * Log in to your Snipe-IT instance as an administrator.

    * Go to **your profile settings** (click your username in the top right, then "Edit Profile" or similar).

    * Find the **"API" or "Personal Access Tokens"** section.

    * Click to **Create New Token**.

    * Give it a descriptive name (e.g., "Google Apps Script Sync").

    * **Permissions:** Ensure this token has at least **read-only access** to **Assets** (or "hardware"). It does not require write permissions for this script.

    * **Copy the generated token.** This is your `SNIPEIT_API_KEY`.

2.  **Configure the Webhook:**

    * In Snipe-IT, navigate to **Admin** > **Webhooks**.

    * Click **Create New Webhook**.

    * **Payload URL:** Paste the **Web app URL** you copied from your Google Apps Script deployment (the one ending with `/exec`).

    * **Secret:** Enter the **exact same `WEBHOOK_SECRET`** you configured in your Google Apps Script properties.

    * **Webhook Events:** Select the events you want to trigger the sync. At a minimum, select:

        * `asset.checkedout`

        * `asset.checkedin`

    * **Optional Headers:** You might want to add `X-Webhook-Secret` and `Referer` headers for additional security, matching your script's validation.

    * **Test Webhook:** Click the **"Test Webhook"** button. It should now pass successfully, as the script is configured to handle this test payload.

    * Click **Save**.

## Usage

Once configured, simply perform asset check-out and check-in actions in Snipe-IT. The webhook will automatically trigger the Google Apps Script, which will then update the corresponding computer record in Jamf Pro.

Monitor the **Execution log** in your Google Apps Script project and the **Webhook Log** Google Sheet for activity and troubleshooting.

## Troubleshooting

* **301/302 Redirect Error in Snipe-IT:** This almost always means the "Payload URL" configured in Snipe-IT is incorrect or redirecting. **Double-check that you copied the exact "Web app URL" ending in `/exec`** from your Google Apps Script deployment.

* **"Event: undefined" in Logs:** This indicates the script couldn't parse the Snipe-IT payload correctly. Ensure Snipe-IT is sending the standard webhook format for asset check-out/check-in events as shown in the examples in the script's comments.

* **"Unauthorized: Secret Mismatch" / "Host Mismatch":**

    * Verify the `WEBHOOK_SECRET` in Snipe-IT exactly matches the one in your Apps Script properties.

    * Ensure the `SNIPEIT_HOST` in your Apps Script properties exactly matches the base URL of your Snipe-IT instance (e.g., `https://your.snipeit.url`).

* **"Could not retrieve serial number from Snipe-IT":**

    * Check that `SNIPEIT_HOST` and `SNIPEIT_API_KEY` are correctly set in your Apps Script properties.

    * Verify the `SNIPEIT_API_KEY` has the necessary **read-only access to Assets** in Snipe-IT.

    * Confirm that the asset tag extracted from the webhook (the number in parentheses in the asset title) actually exists as an asset tag in Snipe-IT.

* **"No Jamf computer found for serial":**

    * Verify that the serial number fetched from Snipe-IT matches a computer's serial number in Jamf Pro.

    * Ensure the Jamf Pro API user has permissions to search for computers.

* **"Jamf update failed":**

    * Check your Jamf Pro API user's permissions. It needs permission to update computer inventory records (specifically the User & Location section).

    * Review the Jamf Pro API error message in the Apps Script logs for more details.