const BASE_URL = process.env.ACE_API_BASE_URL;
const TOKEN = process.env.ACE_API_TOKEN;

// Helper function to wait for a specified amount of time
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function apiFetch(endpoint, options = {}, retries = 3) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${TOKEN}`,
  };

  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, { ...options, headers });

      if (!response.ok) {
        const errorText = await response.text();
        // For server errors (5xx), it's worth retrying. For client errors (4xx), don't retry.
        if (response.status >= 500 && i < retries - 1) {
          console.warn(
            `API server error (${response.status}). Retrying in ${i + 1}s...`
          );
          await delay((i + 1) * 1000); // Wait 1s, 2s, etc.
          continue; // Go to the next iteration of the loop
        }
        throw new Error(`API Error: ${response.status} - ${errorText}`);
      }
      return response.json(); // Success!
    } catch (error) {
      // Check for timeout or network errors to retry
      if (
        (error.cause?.code === "UND_ERR_CONNECT_TIMEOUT" ||
          error.cause?.code === "UND_ERR_SOCKET") &&
        i < retries - 1
      ) {
        console.warn(
          `Network error (${error.cause.code}). Retrying in ${i + 1}s...`
        );
        await delay((i + 1) * 1000); // Wait 1s, 2s, etc.
        continue;
      }
      console.error("API Fetch Error:", error);
      throw error; // If all retries fail, throw the final error
    }
  }
}

export const searchMaintenanceRecords = async () => {
  let allRecords = [];
  let page = 1;
  let hasMorePages = true;

  // *** UPDATED AQL QUERY ***
  // Added cf_pm_completion_date to the query
  const aqlQuery = `select id, parent_id, cf_next_pm_due_date, cf_pm_completion_date, cf_parent_record, cf_parent_equipment_record_new, cf_maintenance_frequency_dropdown, date_created from __main__ JOIN status where type in (${process.env.MAINTENANCE_RECORD_TYPE_ID}) AND status.linked_state neq ${process.env.CANCELLED_STATE_ID}`;

  while (hasMorePages) {
    const response = await apiFetch(`/records/search?page=${page}`, {
      method: "POST",
      body: JSON.stringify({ aql: aqlQuery }),
    });

    if (response && response.data && response.data.length > 0) {
      allRecords = allRecords.concat(response.data);
    }

    if (response && response.links && response.links.next) {
      page++;
    } else {
      hasMorePages = false;
    }
  }
  return allRecords;
};

export const getRecordMetadata = async (recordId) => {
  const response = await apiFetch(`/records/${recordId}/meta`);
  return response.data;
};

export const createMaintenanceRecord = async (payload) => {
  return apiFetch("/records", {
    method: "POST",
    body: JSON.stringify(payload),
  });
};
