let cachedToken = null; // Cache for Jamf Pro API token and its expiration

/**
 * Retrieves configuration properties from Project Properties.
 * @returns {object} Configuration object.
 */
function getConfig() {
  const props = PropertiesService.getScriptProperties();
  return {
    jamfUrl: props.getProperty('JAMF_URL'),
    clientId: props.getProperty('JAMF_CLIENT_ID'),
    clientSecret: props.getProperty('JAMF_CLIENT_SECRET'),
    webhookSecret: props.getProperty('WEBHOOK_SECRET'), // The secret configured in Apps Script properties
    snipeitHost: props.getProperty('SNIPEIT_HOST'), // e.g., 'https://your.snipeit.url'
    logSheetName: props.getProperty('LOG_SHEET_NAME') || 'Webhook Log' // New: Default to 'Webhook Log' if not set
  };
}

/**
 * Obtains and caches a Jamf Pro API Bearer Token using Client Credentials.
 * Tokens expire after 20 minutes by default.
 * @returns {string} The Jamf Pro Bearer Token.
 * @throws {Error} If token retrieval fails.
 */
function getJamfToken() {
  // Check if token is cached and still valid (e.g., within 5 minutes of expiration)
  if (cachedToken && cachedToken.token && cachedToken.expires && (new Date().getTime() < new Date(cachedToken.expires).getTime() - (5 * 60 * 1000))) {
    console.log("Using cached Jamf token.");
    return cachedToken.token;
  }

  const { jamfUrl, clientId, clientSecret } = getConfig();
  if (!jamfUrl || !clientId || !clientSecret) {
    throw new Error('Jamf Pro configuration is incomplete. Check script properties.');
  }

  try {
    // Jamf Pro API token endpoint
    const tokenUrl = `${jamfUrl}/api/v1/auth/token`;
    console.log(`Attempting to get new Jamf token from: ${tokenUrl}`);

    const response = UrlFetchApp.fetch(tokenUrl, {
      method: 'post',
      headers: {
        Authorization: 'Basic ' + Utilities.base64Encode(clientId + ':' + clientSecret),
        'Content-Type': 'application/json'
      },
      muteHttpExceptions: true // Allow us to check response code for errors
    });

    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (responseCode !== 200) {
      console.error(`Jamf Token Error: Status ${responseCode}, Response: ${responseText}`);
      throw new Error(`Failed to get Jamf token. Status: ${responseCode}, Details: ${responseText}`);
    }

    const json = JSON.parse(responseText);
    cachedToken = {
      token: json.token,
      expires: json.expires // Store expiration for caching logic
    };
    console.log("Successfully obtained new Jamf token. Expires:", cachedToken.expires);
    return cachedToken.token;

  } catch (e) {
    console.error(`Error getting Jamf token: ${e.message}`);
    throw e;
  }
}

/**
 * Updates a computer record in Jamf Pro using its serial number with the new Jamf Pro API.
 * It first finds the computer ID by serial number, then performs a PATCH update.
 * @param {string} serialNumber - The serial number of the device to update.
 * @param {string} username - The username to assign (Jamf 'username' field).
 * @param {string} realname - The real name to assign (Jamf 'realName' field).
 * @param {string} locationName - The location name from Snipe-IT (mapped to Jamf 'building' and 'department').
 * @returns {number} The HTTP response code from the Jamf PATCH request.
 * @throws {Error} If Jamf lookup fails or update fails.
 */
function updateJamf(serialNumber, username, realname, locationName) {
  const { jamfUrl } = getConfig();
  const token = getJamfToken();

  // 1. Find computer ID by serial number using /api/v1/computers-inventory with filter
  const lookupUrl = `${jamfUrl}/api/v1/computers-inventory?filter=hardware.serialNumber==${serialNumber}&section=USER_AND_LOCATION`;
  console.log(`Jamf Pro API lookup URL: ${lookupUrl}`);

  let computerId = null;
  try {
    const lookupResp = UrlFetchApp.fetch(lookupUrl, {
      method: 'get',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/json'
      },
      muteHttpExceptions: true
    });

    if (lookupResp.getResponseCode() !== 200) {
      console.error(`Jamf Lookup Error for ${serialNumber}: Status ${lookupResp.getResponseCode()}, Response: ${lookupResp.getContentText()}`);
      throw new Error(`Jamf device lookup failed for serial: ${serialNumber}. Status: ${lookupResp.getResponseCode()}`);
    }

    const searchResults = JSON.parse(lookupResp.getContentText());
    if (searchResults.results && searchResults.results.length > 0) {
      computerId = searchResults.results[0].id;
      console.log(`Found Jamf computer ID ${computerId} for serial ${serialNumber}`);
    } else {
      console.warn(`No Jamf computer found for serial: ${serialNumber}`);
      throw new Error(`No Jamf computer found for serial: ${serialNumber}`);
    }

  } catch (e) {
    console.error(`Error finding Jamf computer by serial ${serialNumber}: ${e.message}`);
    throw e;
  }

  // 2. Update computer using PATCH to /api/v1/computers-inventory/{id}
  // This uses JSON Merge Patch format, so we only send the fields we want to change.
  const payload = {
    userAndLocation: {
      username: username,
      realName: realname,
      building: locationName,  // Map Snipe-IT location to Jamf building
      department: locationName // Map Snipe-IT location to Jamf department
    }
  };

  const updateUrl = `${jamfUrl}/api/v1/computers-inventory/${computerId}`;
  console.log(`Jamf Pro API update URL: ${updateUrl}`);
  console.log(`Jamf Pro API update payload: ${JSON.stringify(payload)}`);

  try {
    const updateResp = UrlFetchApp.fetch(updateUrl, {
      method: 'patch', // Use PATCH for partial updates
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/json'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const updateResponseCode = updateResp.getResponseCode();
    if (updateResponseCode !== 200 && updateResponseCode !== 204) { // 200 OK or 204 No Content for successful PATCH
      console.error(`Jamf Update Error for ${serialNumber}: Status ${updateResponseCode}, Response: ${updateResp.getContentText()}`);
      throw new Error(`Jamf update failed for serial: ${serialNumber}. Status: ${updateResponseCode}, Details: ${updateResp.getContentText()}`);
    }

    console.log(`Successfully updated Jamf for serial ${serialNumber}, status ${updateResponseCode}`);
    return updateResponseCode;

  } catch (e) {
    console.error(`Error in updateJamf for serial ${serialNumber}: ${e.message}`);
    throw e;
  }
}

/**
 * Handles incoming HTTP POST requests from the Snipe-IT webhook.
 * This is the main entry point for the Apps Script Web App.
 * @param {GoogleAppsScript.Events.DoPost} e - The event object containing request parameters.
 * @returns {GoogleAppsScript.Content.TextOutput} A text output response.
 */
function doPost(e) {
  const { webhookSecret, snipeitHost } = getConfig();
  const timestamp = new Date().toISOString();
  let logEntry = [timestamp];

  try {
    // 1. Validate Secret from Header OR URL Parameter
    const headers = e.headers || {};
    const receivedSecretHeader = headers['x-webhook-secret'] || headers['X-Webhook-Secret']; // Case-insensitive check for header
    const receivedSecretParam = e.parameter.secret; // Get from URL query parameter

    let secretIsValid = false;
    if (receivedSecretHeader && receivedSecretHeader === webhookSecret) {
      secretIsValid = true;
      console.log("Webhook authenticated via X-Webhook-Secret header.");
    } else if (receivedSecretParam && receivedSecretParam === webhookSecret) {
      secretIsValid = true;
      console.log("Webhook authenticated via 'secret' URL parameter.");
    } else {
      console.warn(`Unauthorized: Secret Mismatch. Expected: ${webhookSecret}, Received Header: ${receivedSecretHeader}, Received Parameter: ${receivedSecretParam}`);
      logEntry.push('Unauthorized', 'Secret Mismatch');
      appendLog(logEntry);
      return ContentService.createTextOutput('Unauthorized: Secret Mismatch')
        .setMimeType(ContentService.MimeType.TEXT);
    }

    // 2. Validate Referer/Origin Host (Optional, but good for security)
    const referer = headers['referer'] || headers['Referer'] || '';
    const origin = headers['origin'] || headers['Origin'] || '';

    // If snipeitHost is configured, enforce it.
    if (snipeitHost) {
      if (!referer.startsWith(snipeitHost) && !origin.startsWith(snipeitHost)) {
        console.warn(`Unauthorized: Host Mismatch. Expected: ${snipeitHost}, Referer: ${referer}, Origin: ${origin}`);
        logEntry.push('Unauthorized', 'Host Mismatch');
        appendLog(logEntry);
        return ContentService.createTextOutput('Unauthorized: Host Mismatch')
          .setMimeType(ContentService.MimeType.TEXT);
      }
    } else {
      console.log("SNIPEIT_HOST not configured. Skipping host validation.");
    }

    // 3. Parse Payload
    let params;
    try {
      params = JSON.parse(e.postData.contents);
      console.log(`Received Snipe-IT webhook payload: ${JSON.stringify(params)}`);
    } catch (parseError) {
      console.error(`Failed to parse JSON payload: ${parseError.message}, Content: ${e.postData.contents}`);
      logEntry.push('Error', `JSON Parse Error: ${parseError.message}`);
      appendLog(logEntry);
      return ContentService.createTextOutput('Bad Request: Invalid JSON')
        .setMimeType(ContentService.MimeType.TEXT);
    }

    const event = params.event;

    // 4. Filter for asset check-in/checkout events only
    if (event !== 'asset.checkedout' && event !== 'asset.checkedin') {
      console.log(`Ignored event: ${event}. Only asset.checkedout and asset.checkedin are processed.`);
      logEntry.push('Ignored', `Event: ${event}`);
      appendLog(logEntry);
      return ContentService.createTextOutput(`Ignored event: ${event}`)
        .setMimeType(ContentService.MimeType.TEXT);
    }

    const asset = params.asset || {};
    const serial = asset.serial;
    const assignedUser = asset.assigned_to || {};
    const locationObj = asset.location || {};

    // For check-in, clear user fields in Jamf
    const username = (event === 'asset.checkedin') ? '' : assignedUser.username || '';
    const realname = (event === 'asset.checkedin') ? '' : `${assignedUser.first_name || ''} ${assignedUser.last_name || ''}`.trim();
    const location = locationObj.name || ''; // Snipe-IT Location name

    logEntry.push(event, serial, username, realname, location);

    if (!serial) {
      const msg = 'Missing serial number in webhook payload.';
      console.warn(msg);
      logEntry.push('Error', msg);
      appendLog(logEntry);
      return ContentService.createTextOutput(`Missing fields: ${msg}`)
        .setMimeType(ContentService.MimeType.TEXT);
    }

    // 5. Update Jamf Pro
    try {
      const resultCode = updateJamf(serial, username, realname, location);
      logEntry.push('Success', `Jamf Updated (Status: ${resultCode})`);
      appendLog(logEntry);
      return ContentService.createTextOutput(`Jamf updated for ${serial}`)
        .setMimeType(ContentService.MimeType.TEXT);
    } catch (err) {
      console.error(`Jamf update failed for serial ${serial}: ${err.message}`);
      logEntry.push('Failed', `Jamf Error: ${err.message}`);
      appendLog(logEntry);
      return ContentService.createTextOutput(`Jamf update failed for ${serial}: ${err.message}`)
        .setMimeType(ContentService.MimeType.TEXT);
    }

  } catch (globalError) {
    console.error(`Unhandled error in doPost: ${globalError.message}, Stack: ${globalError.stack}`);
    logEntry.push('FATAL ERROR', `Unhandled: ${globalError.message}`);
    appendLog(logEntry);
    return ContentService.createTextOutput(`An unhandled error occurred: ${globalError.message}`)
      .setMimeType(ContentService.MimeType.TEXT);
  }
}

/**
 * Appends a row to the specified Google Sheet for logging.
 * @param {Array<string>} data - The array of data to append as a row.
 */
function appendLog(data) {
  const { logSheetName } = getConfig();
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName(logSheetName);

    if (!sheet) {
      console.error(`Log Sheet Error: Sheet with name '${logSheetName}' not found.`);
      // Fallback: If named sheet not found, try to append to the first sheet
      const firstSheet = spreadsheet.getSheets()[0];
      if (firstSheet) {
        firstSheet.appendRow(['ERROR: Log Sheet not found', ...data]);
        console.warn(`Appended to default sheet as '${logSheetName}' was not found.`);
      } else {
        console.error("No sheets found in the spreadsheet to log to.");
      }
      return; // Exit after attempting fallback
    }
    sheet.appendRow(data);
  } catch (logError) {
    console.error(`Failed to append log to sheet (name: ${logSheetName}): ${logError.message}`);
    // If logging to sheet fails, we can't do much more for logging here.
  }
}

// Function to reset the cached token (useful for debugging or if token expires unexpectedly)
function resetCachedToken() {
  cachedToken = null;
  console.log("Jamf token cache reset.");
}

// You can add a simple doGet for testing if the web app URL is active
function doGet() {
  return ContentService.createTextOutput('This is a POST-only webhook endpoint.').setMimeType(ContentService.MimeType.TEXT);
}