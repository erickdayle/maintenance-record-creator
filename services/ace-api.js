const BASE_URL = process.env.ACE_API_BASE_URL;
const TOKEN = process.env.ACE_API_TOKEN;

async function apiFetch(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${TOKEN}`,
  };

  try {
    const response = await fetch(url, { ...options, headers });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("API Request Failed:", {
        url,
        method: options.method,
        body: options.body,
      });
      throw new Error(`API Error: ${response.status} - ${errorText}`);
    }
    return response.json();
  } catch (error) {
    console.error("API Fetch Error:", error);
    throw error;
  }
}

export const searchMaintenanceRecords = async () => {
  let allRecords = [];
  let page = 1;
  let hasMorePages = true;

  const aqlQuery = `select id, parent_id, cf_next_pm_due_date, cf_parent_record, cf_parent_equipment_record_new, cf_maintenance_frequency_dropdown, date_created from __main__ JOIN status where type in (${process.env.MAINTENANCE_RECORD_TYPE_ID}) AND status.linked_state neq ${process.env.CANCELLED_STATE_ID}`;

  while (hasMorePages) {
    const response = await apiFetch(`/records/search?page=${page}`, {
      method: "POST",
      body: JSON.stringify({ aql: aqlQuery }),
    });

    if (response.data && response.data.length > 0) {
      allRecords = allRecords.concat(response.data);
    }

    if (response.links && response.links.next) {
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
