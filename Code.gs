let cachedToken = null; // Cache for Jamf Pro API token and its expiration

/**
 * Retrieves configuration properties from Project Properties.
 * @returns {object} Configuration object.
 */
function getConfig() {
  const props = PropertiesService.getScriptProperties();
  return {
    jamfUrl: props.getProperty('JAMF_URL'),
    jamfUsername: props.getProperty('JAMF_USERNAME'), // New: Jamf Account Username
    jamfPassword: props.getProperty('JAMF_PASSWORD'), // New: Jamf Account Password
    webhookSecret: props.getProperty('WEBHOOK_SECRET'), // The secret configured in Apps Script properties
    snipeitHost: props.getProperty('SNIPEIT_HOST'), // e.g., 'https://your.snipeit.url'
    snipeitApiKey: props.getProperty('SNIPEIT_API_KEY'), // New: Snipe-IT Personal Access Token
    logSheetName: props.getProperty('LOG_SHEET_NAME') || 'Webhook Log' // Default to 'Webhook Log' if not set
  };
}

/**
 * Obtains and caches a Jamf Pro API Bearer Token using Basic Authentication with a Jamf account.
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

  const { jamfUrl, jamfUsername, jamfPassword } = getConfig();
  if (!jamfUrl || !jamfUsername || !jamfPassword) {
    throw new Error('Jamf Pro username/password configuration is incomplete. Check script properties.');
  }

  try {
    // Jamf Pro API token endpoint
    const tokenUrl = `${jamfUrl}/api/v1/auth/token`;
    console.log(`Attempting to get new Jamf token from: ${tokenUrl}`);

    const response = UrlFetchApp.fetch(tokenUrl, {
      method: 'post',
      headers: {
        Authorization: 'Basic ' + Utilities.base64Encode(jamfUsername + ':' + jamfPassword), // Basic Auth
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
  const token = getJamfToken(); // Get a token using the Jamf account credentials

  // 1. Find computer ID by serial number using /api/v1/computers-inventory with filter
  const lookupUrl = `${jamfUrl}/api/v1/computers-inventory?filter=hardware.serialNumber==${serialNumber}&section=USER_AND_LOCATION`;
  console.log(`Jamf Pro API lookup URL: ${lookupUrl}`);

  let computerId = null;
  try {
    const lookupResp = UrlFetchApp.fetch(lookupUrl, {
      method: 'get',
      headers: {
        Authorization: 'Bearer ' + token, // Use Bearer token for API calls
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
        Authorization: 'Bearer ' + token, // Use Bearer token for API calls
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
 * Extracts the hostname from a given URL string.
 * @param {string} urlString - The URL string.
 * @returns {string|null} The hostname, or null if parsing fails.
*/
function getHostnameFromUrl(urlString) {
  try {
    const url = new URL(urlString);
    return url.hostname;
  } catch (e) {
    console.warn(`Failed to parse URL for hostname: ${urlString}, Error: ${e.message}`);
    return null;
  }
}

/**
 * Fetches the serial number of an asset from Snipe-IT using its asset tag.
 * @param {string} assetTag - The asset tag of the device in Snipe-IT.
 * @returns {string|null} The serial number if found, otherwise null.
*/
function getAssetSerialNumberFromSnipeIT(assetTag) {
  const { snipeitHost, snipeitApiKey } = getConfig();

  if (!snipeitHost || !snipeitApiKey) {
    console.error('Snipe-IT host or API Key is not configured. Cannot fetch serial number.');
    return null;
  }

  const searchUrl = `${snipeitHost}/api/v1/hardware?search=${assetTag}`;
  console.log(`Searching Snipe-IT for asset tag '${assetTag}' at: ${searchUrl}`);

  try {
    const response = UrlFetchApp.fetch(searchUrl, {
      method: 'get',
      headers: {
        'Authorization': 'Bearer ' + snipeitApiKey,
        'Accept': 'application/json'
      },
      muteHttpExceptions: true
    });

    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (responseCode !== 200) {
      console.error(`Snipe-IT API Error for asset tag ${assetTag}: Status ${responseCode}, Response: ${responseText}`);
      return null;
    }

    const jsonResponse = JSON.parse(responseText);

    if (jsonResponse.rows && jsonResponse.rows.length > 0) {
      // Iterate through results to find an exact match by asset_tag
      for (const asset of jsonResponse.rows) {
        if (asset.asset_tag === assetTag) {
          console.log(`Found serial number '${asset.serial}' for asset tag '${assetTag}' in Snipe-IT.`);
          return asset.serial;
        }
      }
      console.warn(`No exact match found for asset tag '${assetTag}' in Snipe-IT results.`);
      return null;
    } else {
      console.warn(`No assets found in Snipe-IT for search term '${assetTag}'.`);
      return null;
    }

  } catch (e) {
    console.error(`Error fetching serial number from Snipe-IT for asset tag ${assetTag}: ${e.message}`);
    return null;
  }
}


/**
 * Handles incoming HTTP POST requests from the Snipe-IT webhook.
 * This is the main entry point for the Apps Script Web App.
 * @param {GoogleAppsScript.Events.DoPost} e - The event object containing request parameters.
 * @returns {GoogleAppsScript.Content.TextOutput} A text output response with 200 OK status.
*/
function doPost(e) {
  const { webhookSecret, snipeitHost } = getConfig();
  const timestamp = new Date().toISOString();
  let logEntry = [timestamp];
  let responseMessage = "OK: Webhook processed successfully."; // Default success message

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
      responseMessage = 'OK: Unauthorized - Secret Mismatch';
      return ContentService.createTextOutput(responseMessage).setMimeType(ContentService.MimeType.TEXT);
    }

    // 2. Validate Referer/Origin Host (Optional, but good for security)
    const referer = headers['referer'] || headers['Referer'] || '';
    const origin = headers['origin'] || headers['Origin'] || '';

    // If snipeitHost is configured, enforce it.
    if (snipeitHost) {
      const expectedHostname = getHostnameFromUrl(snipeitHost);
      const refererHostname = getHostnameFromUrl(referer);
      const originHostname = getHostnameFromUrl(origin);

      if (!expectedHostname) {
        console.error(`Configuration Error: SNIPEIT_HOST '${snipeitHost}' is not a valid URL.`);
        logEntry.push('Configuration Error', 'Invalid SNIPEIT_HOST URL');
        appendLog(logEntry);
        responseMessage = 'OK: Internal Error - Invalid SNIPEIT_HOST configuration.';
        return ContentService.createTextOutput(responseMessage).setMimeType(ContentService.MimeType.TEXT);
      }

      // Check if either referer or origin hostname matches the expected hostname
      if (refererHostname !== expectedHostname && originHostname !== expectedHostname) {
        console.warn(`Unauthorized: Host Mismatch. Expected Host: ${expectedHostname}, Referer Host: ${refererHostname}, Origin Host: ${originHostname}`);
        logEntry.push('Unauthorized', `Host Mismatch. Expected: ${expectedHostname}, Referer: ${refererHostname}, Origin: ${originHostname}`);
        appendLog(logEntry);
        responseMessage = 'OK: Unauthorized - Host Mismatch';
        return ContentService.createTextOutput(responseMessage).setMimeType(ContentService.MimeType.TEXT);
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
      responseMessage = 'OK: Bad Request - Invalid JSON Payload';
      return ContentService.createTextOutput(responseMessage).setMimeType(ContentService.MimeType.TEXT);
    }

    // --- Handle Snipe-IT Test Webhook ---
    if (params.channel === "#jamfbot" && params.text && params.text.includes("General Webhook integration with Snipe-IT is working!")) {
      console.log("Received Snipe-IT test webhook. Returning success.");
      logEntry.push('Test Webhook', 'Success');
      appendLog(logEntry);
      responseMessage = 'OK: Snipe-IT test webhook received successfully.';
      return ContentService.createTextOutput(responseMessage).setMimeType(ContentService.MimeType.TEXT);
    }

    // --- Parse Actual Asset Event Payload ---
    let eventType = '';
    let assetTag = ''; // Will store the (ID) from the title, e.g., 18163
    let parsedUsername = '';
    let parsedRealname = '';
    let parsedLocation = '';

    // Determine event type from 'text' field
    if (params.text) {
      if (params.text.includes("Asset checked out")) {
        eventType = 'asset.checkedout';
      } else if (params.text.includes("Asset checked in")) {
        eventType = 'asset.checkedin';
      }
    }

    // If it's an asset event, parse details from attachments
    if (eventType && params.attachments && params.attachments.length > 0) {
      const attachment = params.attachments[0];

      // Extract asset tag from title (e.g., 18163 from "MacBook 28 (18163)...")
      const titleMatch = attachment.title ? attachment.title.match(/\((\d+)\)/) : null;
      if (titleMatch && titleMatch[1]) {
        assetTag = titleMatch[1];
        console.log(`Extracted asset tag from webhook: ${assetTag}`);
      } else {
        const msg = "Could not extract asset tag from attachment title. Cannot proceed with Jamf update.";
        console.warn(msg);
        logEntry.push('Error', msg);
        appendLog(logEntry);
        responseMessage = `OK: Missing asset tag - ${msg}`;
        return ContentService.createTextOutput(responseMessage).setMimeType(ContentService.MimeType.TEXT);
      }

      // Parse user and location from fields
      if (attachment.fields && attachment.fields.length > 0) {
        for (const field of attachment.fields) {
          if (field.title === "To" || field.title === "Administrator") {
            // Extract name from link format: <URL|Name>
            const nameMatch = field.value ? field.value.match(/\|([^>]+)>$/) : null;
            if (nameMatch && nameMatch[1]) {
              parsedRealname = nameMatch[1];
              // Derive username (lowercase, no spaces) - This is an assumption based on common naming conventions.
              parsedUsername = parsedRealname.toLowerCase().replace(/\s/g, '');
              console.log(`Parsed Real Name: ${parsedRealname}, Derived Username: ${parsedUsername}`);
            } else {
              console.warn(`Could not parse user name from field: ${field.value}`);
            }
          } else if (field.title === "Location") {
            parsedLocation = field.value || ''; // Location might be empty
            console.log(`Parsed Location: ${parsedLocation}`);
          }
        }
      }
    }

    // 4. Filter for recognized asset events
    if (eventType !== 'asset.checkedout' && eventType !== 'asset.checkedin') {
      console.log(`Ignored event: ${eventType}. Only asset.checkedout and asset.checkedin are processed.`);
      logEntry.push('Ignored', `Event: ${eventType}`);
      appendLog(logEntry);
      responseMessage = `OK: Ignored event: ${eventType}`;
      return ContentService.createTextOutput(responseMessage).setMimeType(ContentService.MimeType.TEXT);
    }

    // --- Fetch Serial Number from Snipe-IT using Asset Tag ---
    const actualSerialNumber = getAssetSerialNumberFromSnipeIT(assetTag);

    if (!actualSerialNumber) {
      const msg = `Could not retrieve serial number from Snipe-IT for asset tag: ${assetTag}. Cannot update Jamf.`;
      console.warn(msg);
      logEntry.push('Error', msg);
      appendLog(logEntry);
      responseMessage = `OK: Failed to get serial number from Snipe-IT for asset tag ${assetTag}.`;
      return ContentService.createTextOutput(responseMessage).setMimeType(ContentService.MimeType.TEXT);
    }

    // Log the parsed data for the actual event including the fetched serial
    logEntry.push(eventType, assetTag, actualSerialNumber, parsedUsername, parsedRealname, parsedLocation);

    // 5. Update Jamf Pro
    try {
      // Pass the fetched actualSerialNumber to updateJamf.
      const resultCode = updateJamf(actualSerialNumber, parsedUsername, parsedRealname, parsedLocation);
      logEntry.push('Success', `Jamf Updated (Status: ${resultCode})`);
      appendLog(logEntry);
      responseMessage = `OK: Jamf updated for serial ${actualSerialNumber}`;
      return ContentService.createTextOutput(responseMessage).setMimeType(ContentService.MimeType.TEXT);
    } catch (err) {
      console.error(`Jamf update failed for serial ${actualSerialNumber} (asset tag ${assetTag}): ${err.message}`);
      logEntry.push('Failed', `Jamf Error: ${err.message}`);
      appendLog(logEntry);
      responseMessage = `OK: Jamf update failed for serial ${actualSerialNumber}: ${err.message}`;
      return ContentService.createTextOutput(responseMessage).setMimeType(ContentService.MimeType.TEXT);
    }

  } catch (globalError) {
    // Catch any unhandled errors and still return 200 OK
    console.error(`Unhandled error in doPost: ${globalError.message}, Stack: ${globalError.stack}`);
    logEntry.push('FATAL ERROR', `Unhandled: ${globalError.message}`);
    appendLog(logEntry);
    responseMessage = `OK: An unhandled internal error occurred. Please check logs.`;
    return ContentService.createTextOutput(responseMessage).setMimeType(ContentService.MimeType.TEXT);
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
